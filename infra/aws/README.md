# AWS 운영 구성

로컬에서 검증한 애플리케이션을 운영 환경에 올릴 때의 구성이다.
`cloudformation/prop-data-hub.yml`은 **문법 검증만 마쳤고 실제 배포·운영은 하지 않았다**. 계정·도메인·VPC가 정해지면
아래 순서로 적용한다.

## 구성도

```
                    ┌──────────────────────────┐
   사용자 ─────────▶│ CloudFront + S3 (정적 데모) │  docs/ 산출물
                    └──────────────────────────┘
   프론트(API 연동) ─▶ ALB (HTTPS)
                         │
                         ▼
                 ┌──────────────────────────┐
                 │ ECS Fargate: api (2 태스크) │
                 └──────────┬───────────────┘
                            │ 5432
                            ▼
                 ┌──────────────────────────┐
                 │ RDS PostgreSQL 16 (프라이빗) │
                 └──────────▲───────────────┘
                            │
       EventBridge Scheduler│ 매일 02:00 KST
       (cron 0 2 * * ? *)   │ ecs:RunTask
                            │
                 ┌──────────┴───────────────┐
                 │ ECS Fargate: collector    │  실거래·ECOS 수집
                 │ (1회 실행 후 종료)         │  실패 시 DLQ 테이블
                 └──────────────────────────┘
```

## 리소스

| 구분 | 리소스 | 비고 |
| --- | --- | --- |
| 컴퓨팅 | ECS Fargate `api` (0.5 vCPU/1GB, 2 태스크) | ALB 뒤에서 무중단 배포, circuit breaker 롤백 |
| 컴퓨팅 | ECS Fargate `collector` (0.5 vCPU/1GB) | EventBridge가 1회 실행, 재시도 2회 |
| DB | RDS PostgreSQL 16.4 `db.t4g.micro` | gp3 20GB, 백업 7일, 암호화, 퍼블릭 접근 차단 |
| 스케줄 | EventBridge Scheduler `cron(0 2 * * ? *)` Asia/Seoul | 월~일 매일. 실거래 신고 반영 주기에 맞춰 조정 |
| 정적 배포 | S3(비공개) + CloudFront OAC | `docs/` 업로드, HTTPS 강제 |
| 시크릿 | SSM Parameter Store SecureString | `DATABASE_URL`, `MOLIT_SERVICE_KEY`, `ECOS_API_KEY` |
| 로그 | CloudWatch Logs `/ecs/prop-data-hub/{api,collector}` | 30일 보존 |
| 알람 | ALB 5xx, RDS CPU | SNS 구독은 운영 계정에서 연결 |

## 배포 순서

1. **이미지 빌드·푸시** (ECR 저장소 두 개를 먼저 만든다)
   ```bash
   docker build -f infra/docker/api.Dockerfile -t prop-data-hub-api .
   docker build -f infra/docker/collector.Dockerfile -t prop-data-hub-collector .
   docker tag prop-data-hub-api:latest <account>.dkr.ecr.ap-northeast-2.amazonaws.com/prop-data-hub-api:latest
   docker push <account>.dkr.ecr.ap-northeast-2.amazonaws.com/prop-data-hub-api:latest
   ```
2. **SSM 파라미터 등록**
   ```bash
   aws ssm put-parameter --name /prop-data-hub/database-url --type SecureString \
     --value "postgres://prop:<password>@<rds-endpoint>:5432/prop_data_hub"
   aws ssm put-parameter --name /prop-data-hub/molit-service-key --type SecureString --value "<decoding key>"
   aws ssm put-parameter --name /prop-data-hub/ecos-api-key --type SecureString --value "<ecos key>"
   ```
3. **스택 생성**
   ```bash
   aws cloudformation deploy \
     --stack-name prop-data-hub \
     --template-file infra/aws/cloudformation/prop-data-hub.yml \
     --capabilities CAPABILITY_IAM \
     --parameter-overrides VpcId=vpc-... PublicSubnetIds=subnet-a,subnet-b \
       PrivateSubnetIds=subnet-c,subnet-d ApiImage=... CollectorImage=... DbPassword=...
   ```
4. **스키마 적용** (RDS가 만든 뒤 한 번)
   ```bash
   DATABASE_URL="postgres://prop:<password>@<rds-endpoint>:5432/prop_data_hub" pnpm db:init
   ```
5. **프론트 배포**
   ```bash
   pnpm --filter @prop/web build
   aws s3 sync docs/ s3://<SiteBucketName>/ --delete
   aws cloudfront create-invalidation --distribution-id <id> --paths "/*"
   ```

## 비용 가정 (서울 리전, 2026년 기준 개략치)

| 항목 | 월 예상 |
| --- | --- |
| Fargate api 2 태스크 (0.5vCPU/1GB 상시) | 약 $30 |
| Fargate collector (1일 1회, 수 분) | $1 미만 |
| RDS db.t4g.micro + gp3 20GB | 약 $20 |
| ALB | 약 $20 |
| CloudFront/S3 | 소액 |
| CloudWatch Logs·알람 | 소액 |
| **합계** | **약 $70~80/월** |

비용을 더 줄이려면 API를 Fargate Spot + 최소 1태스크로 두거나, RDS를 Aurora Serverless v2 최소 용량으로 바꾼다.
수집 워커는 Lambda(15분 제한)보다 Fargate가 적합하다. 백필처럼 24개월×여러 지역을 도는 작업은 15분을 넘길 수 있다.

## 운영 시 확인할 것

- RDS `max_connections`(t4g.micro 기본 85)와 API 풀 크기(`PG_POOL_MAX`)의 합이 넘지 않게 조정
- 수집 워커의 동시 실행 1개 보장(EventBridge 스케줄 중복 실행 시 `pipeline_runs`가 겹칠 수 있음)
- 실제 공공데이터 호출 한도(일일 트래픽)와 `MOLIT_REQUESTS_PER_SECOND` 일치
- ALB 액세스 로그와 CloudWatch 알람 SNS 구독 연결
- 월 파티션 `user_behavior_events_YYYYMM` 생성·보존 잡(예: 매월 1일 Lambda 또는 pg_cron)
