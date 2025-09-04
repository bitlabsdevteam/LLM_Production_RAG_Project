# LLM_Production_RAG_Project

## JioPay FAQ Crawler

An AWS Lambda function that uses Puppeteer with headless Chromium to crawl Single Page Application (SPA) Help Centers, discover submenu routes, expand FAQ accordions, and extract question/answer content. All outputs (HTML, images, text) are saved to S3 under specified prefixes.

### Features

- **Route Discovery**: Automatically discovers submenu routes/tabs using configurable selectors
- **FAQ Expansion**: Clicks to expand FAQ accordions and extracts question/answer content
- **Multiple Output Formats**: Saves full HTML pages, question/answer screenshots, and structured text data
- **S3 Integration**: Stores all outputs in organized S3 buckets and prefixes
- **Error Handling**: Captures diagnostic screenshots and HTML on failures
- **Configurable**: All selectors, timeouts, and behaviors are configurable via input parameters

### Setup

#### Prerequisites

- AWS Account with permissions to create Lambda functions, ECR repositories, and S3 buckets
- AWS CLI configured with appropriate credentials
- Docker installed locally
- Node.js 16+ installed locally

#### Installation

1. Clone this repository
2. Update the AWS account ID in `package.json` scripts
3. Create an ECR repository for the container image:

```bash
aws ecr create-repository --repository-name jiopay-crawler
```

4. Build and deploy the container:

```bash
# Build the Docker image
npm run build

# Push to ECR
npm run push

# Create the Lambda function (first time only)
aws lambda create-function \
  --function-name jiopay-crawler \
  --package-type Image \
  --code ImageUri=YOUR_AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/jiopay-crawler:latest \
  --role YOUR_LAMBDA_EXECUTION_ROLE_ARN \
  --timeout 300 \
  --memory-size 2048 \
  --environment Variables="{BUCKET=your-output-bucket,OUTPUT_PREFIX=jiopay-help/faqs,LOG_LEVEL=info}"

# Update existing Lambda function
npm run deploy
```

### Configuration

#### Environment Variables

| Variable | Description | Default |
|----------|-------------|--------|
| `BUCKET` | S3 bucket for storing outputs | (required) |
| `OUTPUT_PREFIX` | S3 prefix for organizing outputs | `jiopay-help/faqs` |
| `LOG_LEVEL` | Logging verbosity (error, warn, info, debug) | `info` |
| `USER_AGENT` | Custom User-Agent string | `JioPay-FAQ-Crawler/1.0` |

#### Lambda Configuration

**Memory and Timeout**

- **Memory**: Minimum 2048 MB recommended (Chromium is memory-intensive)
- **Timeout**: Minimum 3 minutes (180 seconds) recommended, up to 15 minutes for complex sites

#### Input Parameters

The Lambda function accepts a JSON event with the following parameters:

```json
{
  "startUrl": "https://example.help/faq",
  "submenuSelectors": ["button.chip", "a.tab", "nav .pill"],
  "routeDiscovery": "links|tabs|hash",
  "questionSelector": ".accordion .question",
  "answerSelector": ".accordion .answer",
  "expandAction": "click",
  "waitFor": {
    "selector": ".accordion",
    "networkIdleMs": 500
  },
  "outputPrefix": "jiopay-help/faqs",
  "bucket": "my-output-bucket",
  "maxRoutes": 50,
  "delayMs": 200,
  "headless": true,
  "viewport": {"width": 1366, "height": 900},
  "timeoutMs": 60000
}
```

See `example-payload.json` for a sample configuration.

### Output Structure

The crawler organizes outputs in S3 with the following structure:

```
s3://<bucket>/<prefix>/
  ├── html/
  │   ├── <routeKey>.html         # Full page HTML after expansions
  │   └── errors/                 # HTML from failed routes
  ├── images/
  │   ├── <routeKey>/            # Screenshots of expanded Q&As
  │   │   ├── 0.png
  │   │   ├── 1.png
  │   │   └── ...
  │   └── errors/                 # Error screenshots
  └── text/
      ├── <routeKey>.ndjson      # Structured Q&A data
      └── errors.ndjson          # Error logs
```

### Local Testing

To test the function locally:

```bash
# Build the Docker image
npm run build

# Run locally
npm run local-test

# In another terminal, invoke the function
curl -XPOST "http://localhost:9000/2015-03-31/functions/function/invocations" -d @example-payload.json
```

### Troubleshooting

#### Common Issues

**Chromium Path Issues**

*Symptom*: Error about Chromium executable not found

*Solution*: Verify the Chromium path in the container:

```bash
docker run -it --entrypoint /bin/bash jiopay-crawler:latest
ls -la /opt/chrome/chrome
```

Ensure the `CHROME_PATH` environment variable is set correctly in the Dockerfile.

**Memory Errors**

*Symptom*: Lambda function crashes with out-of-memory errors

*Solution*: Increase the Lambda memory allocation to at least 2048 MB. Consider optimizing the crawler by:

- Reducing the viewport size
- Processing fewer routes per invocation
- Further limiting resource loading

**Timeouts**

*Symptom*: Lambda function times out before completion

*Solution*:

- Increase the Lambda timeout setting
- Reduce `maxRoutes` to process fewer routes per invocation
- Implement a step function to chain multiple Lambda invocations

**Permission Issues**

*Symptom*: S3 access denied errors

*Solution*: Ensure the Lambda execution role has appropriate S3 permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::your-bucket-name",
        "arn:aws:s3:::your-bucket-name/*"
      ]
    }
  ]
}
```

### Alternative Deployment: Lambda Layer

As an alternative to the container approach, you can use Lambda Layers with `chrome-aws-lambda` and `puppeteer-core`. Note that this approach has size limitations and may be less reliable across Lambda runtime updates.