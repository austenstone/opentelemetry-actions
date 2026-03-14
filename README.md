# OpenTelemetry GitHub Actions Runner Telemetry

This repo gives you an opinionated GitHub Actions story for **GitHub-hosted runners**, **larger runners**, and **custom images**:

- stream runner vitals to any **OTLP HTTP metrics endpoint**
- capture **CPU, RAM, disk, load, process, and network** telemetry during a job
- emit a **job summary verdict** on whether you need a larger runner
- support a **summary-only mode** when you want no backend at all
- flag when **custom images** are probably the better optimization than brute-force bigger iron
- ship with a **local OTel Collector + Prometheus + Grafana** stack for demos

If you want the short answer on tooling:

- **Best default:** **Grafana Cloud**
- **Best local demo stack:** **Grafana + Prometheus + OpenTelemetry Collector** in `observability/`
- **Best if you mostly care about traces and debugging app behavior:** **Honeycomb**

For **runner performance storytelling and rightsizing**, Grafana is the best fit. It is cheap to explain, OTel-native enough, great at time series, and customers already know what the charts mean. Honeycomb is awesome, but it is the wrong hero if the story is “this job is CPU-bound and your 4-core runner is crying.”

## What this action emits

Metric prefix defaults to `github.runner`.

### Core vitals

- `github.runner.cpu.utilization_pct`
- `github.runner.cpu.user_pct`
- `github.runner.cpu.system_pct`
- `github.runner.cpu.logical_cores`
- `github.runner.memory.utilization_pct`
- `github.runner.memory.used_bytes`
- `github.runner.memory.available_bytes`
- `github.runner.memory.total_bytes`
- `github.runner.swap.utilization_pct`
- `github.runner.disk.utilization_pct`
- `github.runner.disk.used_bytes`
- `github.runner.disk.available_bytes`
- `github.runner.disk.total_bytes`
- `github.runner.disk.io_read_ops_per_sec`
- `github.runner.disk.io_write_ops_per_sec`
- `github.runner.filesystem.throughput_bytes_per_sec`
- `github.runner.network.rx_bytes_per_sec`
- `github.runner.network.tx_bytes_per_sec`
- `github.runner.load_1m`
- `github.runner.load_5m`
- `github.runner.load_15m`
- `github.runner.processes.running`
- `github.runner.processes.blocked`
- `github.runner.processes.sleeping`

### Useful resource attributes

Every metric is tagged with job context you can filter on in Grafana:

- `repository`
- `workflow`
- `job`
- `run_id`
- `run_attempt`
- `actor`
- `git_ref`
- `sha`
- `runner_name`
- `runner_os`
- `runner_arch`

## How the story works

This is the pitch track the data supports:

### Move to a larger runner when

- CPU p95 is consistently above **85%**
- memory peaks above **80%**
- disk pressure is regularly ugly
- load average stays pinned relative to available cores

### Move to a custom image when

- total runtime is still long
- CPU/memory/disk pressure stay low
- the job is mostly paying the **“install the world again” tax**

That gives you a clean customer narrative:

> “You do **not** have a compute problem. You have a provisioning/setup problem. A custom base image on larger runners cuts setup waste without blindly paying for bigger hardware.”

## Quick start

### 1. Point the action at an OTLP endpoint

Set these secrets in the repository or organization:

- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OTEL_EXPORTER_OTLP_HEADERS` (optional)

The endpoint should be the **full OTLP HTTP metrics URL**.

Examples:

- Grafana Cloud: region-specific OTLP gateway URL ending in `/v1/metrics` or vendor-provided OTLP metrics path
- Public collector: `https://collector.example.com/v1/metrics`

### 2. Use the action in a workflow

```yaml
- name: Stream runner telemetry
  uses: ./
  with:
    otlp-endpoint: ${{ secrets.OTEL_EXPORTER_OTLP_ENDPOINT }}
    otlp-headers: ${{ secrets.OTEL_EXPORTER_OTLP_HEADERS }}
    additional-resource-attributes: team=actions,environment=prod
```

Drop it in **early** in the job so the monitored window covers the real work.

### 2b. Use summary-only mode

If you only want the recommendation summary and do **not** want to export to any OTLP backend:

```yaml
- name: Runner sizing summary only
  uses: ./
  with:
    summary-only: true
```

That mode still samples CPU, RAM, disk, load, process, and network locally on the runner. It just skips OTLP export and trace export.

### 3. Read the job summary

At the end of the job the action writes a markdown summary with:

- CPU / memory / disk averages, p95s, and peaks
- likely bottleneck
- larger runner recommendation
- custom image candidate flag

## Included workflows

### `.github/workflows/ci.yml`

Dogfoods the action on this repo’s own CI. If OTLP secrets exist, it streams metrics. If not, you can still use summary-only mode.

### `.github/workflows/compare-runner-sizes.yml`

Manual A/B comparison:

- `baseline`: `ubuntu-latest`
- `candidate`: your larger runner label

Use this to show a before/after story for the same workload.

### `.github/workflows/build-custom-image.yml`

Builds a **custom image** for a larger runner using GitHub’s `snapshot` support.

It preinstalls:

- `jq`
- `fio`
- `stress-ng`
- `sysstat`
- `unzip`

That makes it easier to separate:

- **runtime setup waste**
- **actual CPU / RAM / disk contention**

## Local demo stack

The `observability/` directory gives you:

- OpenTelemetry Collector on `4318`
- Prometheus on `9090`
- Grafana on `3000`

Important reality check: **GitHub-hosted runners cannot reach your laptop’s localhost**. For real GitHub-hosted runner demos, use a public collector or Grafana Cloud. The local stack is for development, screenshots, and rehearsing the dashboard story.

### Run it

```bash
docker compose -f observability/docker-compose.yml up -d
```

Grafana login:

- user: `admin`
- password: `admin`

## Suggested Grafana storyboards

### “Is this runner too small?”

Show these together:

- CPU utilization
- memory utilization
- disk utilization
- load average
- total workflow duration by runner label

### “Would a custom image help more than a bigger runner?”

Show these together:

- low CPU / memory pressure
- long job durations
- repeated setup-heavy workflows
- before/after image rollout

### “What changed after moving to larger runners?”

Compare baseline vs candidate on:

- p95 CPU
- max memory pressure
- workflow duration
- filesystem throughput

## Recommended backend choices

### Grafana Cloud — my recommendation

Use this when you want the fewest moving parts and the cleanest demo.

Why it wins here:

- OTLP-friendly ingest
- great dashboards for infra time series
- easy to compare runner classes and image versions
- fastest path to a polished customer-facing story

### Honeycomb — awesome, but not first for this use case

Use Honeycomb if you also want to correlate CI telemetry with application traces or debugging workflows. For pure runner vitals and rightsizing? Grafana is simply the more natural hammer.

### Datadog / New Relic / Chronosphere

All viable if the customer already owns one. I would not introduce a new paid platform just to tell a runner sizing story unless there is already platform gravity there.

## Development

### Install

```bash
npm ci
```

### Test

```bash
npm test
```

### Build action bundles

```bash
npm run build
```

## Notes on custom images

GitHub custom images for larger runners are in **public preview** and only work with **GitHub-hosted larger runners**. The basic workflow is:

1. create an image-generation runner
2. run a workflow with `snapshot`
3. install that custom image on a larger runner

This repo includes a workflow for exactly that.

Security-wise, keep image-generation runners in a **dedicated runner group**. Do not let random dev repos write to the thing that bakes your production runner image. That is how you end up with a very creative incident review.

## Try it on a real larger runner

1. create a larger runner in your org
2. point `compare-runner-sizes.yml` at that runner label
3. run it once on standard hosted, once on larger
4. show the Grafana dashboard + job summary
5. decide whether the right answer is:
   - more cores / RAM
   - faster disk / bigger runner
   - custom image
   - all of the above

## What I’d pitch to a customer

- If CPU is pinned: **larger runner**
- If memory peaks hard: **larger runner**
- If disk/setup dominates and compute is chill: **custom image first**
- If you need a boardroom-safe first implementation: **Grafana Cloud + this action + a larger-runner A/B workflow**

That combo tells a very clean story without inventing observability theater.
