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

### Runtime compatibility

This action now runs on **Node.js 24**.

- JavaScript actions in this repo use the Node 24 runtime
- bundled workflows pin Node 24-compatible versions of `actions/checkout` and `actions/setup-node`
- GitHub-hosted runners are already compatible
- for self-hosted runners, make sure the runner version is at least `v2.327.1`

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

The action also writes a raw telemetry bundle at the `raw-bundle-path` output containing:

- sampled runner vitals
- computed summary
- non-secret config metadata
- optional trace metadata
- daemon error text if sampling had issues

In `summary-only` mode, the action uploads that raw bundle as a GitHub Actions artifact automatically from its `post` step.

The artifact name format is:

```text
raw-runner-telemetry-<run_id>-<run_attempt>-<job>
```

If you still want the raw file path for custom handling, the `raw-bundle-path` output is available during the job.

Example:

```yaml
- name: Runner sizing summary only
  id: telemetry
  uses: ./
  with:
    summary-only: true

- name: Print raw bundle path
  if: always()
  run: echo "Raw bundle path: ${{ steps.telemetry.outputs.raw-bundle-path }}"
```

### 3. Read the job summary

At the end of the job the action writes a markdown summary with:

- CPU / memory / disk averages, p95s, and peaks
- likely bottleneck
- larger runner recommendation
- custom image candidate flag

In summary-only mode, the included `test-action.yml` workflow relies on the action itself to upload the raw telemetry artifact automatically.

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
- `otelcol-contrib`

That makes it easier to separate:

- **runtime setup waste**
- **actual CPU / RAM / disk contention**

### Autonomous custom-image telemetry mode

If you use the generated custom image on a larger runner, you can collect runner host metrics
without calling this action at all.

The image bakes in:

- `otelcol-contrib`
- a pre-job hook at `/opt/runner/pre-job.sh`
- a post-job hook at `/opt/runner/post-job.sh`
- a runtime config generator at `/opt/runner/render-otel-config.py`
- helper install scripts from `scripts/custom-image/`

That means every workflow job running on the custom-image runner starts a background collector
automatically before the first step and stops it after the final step.

The baked collector:

- scrapes host CPU, memory, filesystem, disk, load, network, and process metrics
- can export upstream automatically if shared org-level settings are present

Recommended shared org settings:

- org variable: `RUNNER_OTEL_EXPORTER_OTLP_ENDPOINT`
- org secret: `RUNNER_OTEL_EXPORTER_OTLP_HEADERS` (optional)
- org variable: `RUNNER_OTEL_RESOURCE_ATTRIBUTES` (optional comma-delimited key/value pairs)

Optional shared org variables for fleet metadata:

- `RUNNER_OTEL_SERVICE_NAME`
- `RUNNER_OTEL_ENVIRONMENT`
- `RUNNER_OTEL_TEAM`
- `RUNNER_OTEL_CLASS`
- `RUNNER_OTEL_REPO_TYPE`
- `RUNNER_OTEL_BENCHMARK`

Example workflow env when using the custom-image runner:

```yaml
env:
  RUNNER_OTEL_EXPORTER_OTLP_ENDPOINT: ${{ vars.RUNNER_OTEL_EXPORTER_OTLP_ENDPOINT }}
  RUNNER_OTEL_EXPORTER_OTLP_HEADERS: ${{ secrets.RUNNER_OTEL_EXPORTER_OTLP_HEADERS }}
  RUNNER_OTEL_RESOURCE_ATTRIBUTES: >-
    team=actions,environment=prod,runner_class=larger
```

With that setup, the custom image gives you always-on runner hostmetrics for the whole job.
No explicit `uses: ./` step is required.

Important tradeoff: this autonomous collector mode replaces the action for telemetry shipping,
but it does **not** reproduce the action-specific markdown summary, raw telemetry artifact, or
rightsizing recommendation logic. If you want those outputs, keep using the action.

## Local demo stack

The `observability/` directory gives you:

- OpenTelemetry Collector on `4318`
- Prometheus on `9090`
- Grafana on `3000`
- optional ngrok tunnel with a public OTLP HTTP endpoint

Important reality check: **GitHub-hosted runners cannot reach your laptop’s localhost**. This repo now includes a Dockerized ngrok tunnel so you can expose the local collector temporarily and point GitHub-hosted runners at it.

### Fastest path

1. Put your ngrok token in `.env`:

```bash
NGROK_AUTHTOKEN=your-ngrok-token
```

2. Start the full local stack and tunnel:

```bash
./scripts/start-local-grafana-stack.sh
```

3. Run the `Test runner telemetry action` workflow.

The helper script starts Docker, creates an ngrok tunnel to the local collector, and updates the repo secret `OTEL_EXPORTER_OTLP_ENDPOINT` to the public tunnel URL ending in `/v1/metrics`.

### Manual run

```bash
docker compose -f observability/docker-compose.yml up -d
```

Grafana login:

- user: `admin`
- password: `admin`

ngrok inspection UI:

- `http://127.0.0.1:4040` by default

If those default ports are already in use, the helper script auto-selects free host ports and prints the actual URLs.

If you want the public tunnel too, use:

```bash
docker compose -f observability/docker-compose.yml --profile tunnel up -d
```

### Stop it

```bash
./scripts/stop-local-grafana-stack.sh
```

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
