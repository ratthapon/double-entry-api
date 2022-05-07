# Serverless Double Entry Bookkeeping for Scalable Currency API

## How to deployment in local dev

### 1. Setup AWS account and any neccessary IAM

### 2. Install SAM CLI as explained in [this guide](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html)

### 3. Setup SAM config by 

```bash
sam init
```
setup deployment specs in `samconfig.toml`

```bash
sam deploy --guided
```
setup deployment specs in `samconfig.toml`

### 4. Run dev environment locally

```bash
sam local start-api --region ap-southeast-1
```

## How to deploy in prod env

Follows step 1-3 as above. Then invoke deploy command.

```bash
sam build && sam deploy --stack-name double-entry-api
```

## How to deploy in hybrid cloud-local env

This will update the stack on cloud if the local files were changed.

```bash
sam sync --stack-name double-entry-api --region ap-southeast-1 --watch
// OR specify --resource-id defined in template.yaml
sam sync --stack-name double-entry-api --region ap-southeast-1 --resource-id CurrencyFund --watch
```