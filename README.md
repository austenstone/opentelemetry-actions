# OpenTelemetry for GitHub Actions

This repository is an **OpenTelemetry solution for GitHub Actions**.

It gives you two ways to collect telemetry from GitHub Actions jobs:

1. a **GitHub Action** that samples runner vitals during a job and exports them to an OTLP endpoint
2. a **custom-image mode** for GitHub-hosted larger runners that starts an OpenTelemetry Collector automatically for every job

The core goal is simple:

- capture runner-level telemetry from GitHub Actions jobs
- attach useful workflow metadata
- export the data to any OpenTelemetry-compatible backend
- provide a local Collector + Prometheus + Grafana stack for testing and demos

Anything related to summaries or runner recommendations is optional and secondary. The primary job of this repo is to get GitHub Actions telemetry into OpenTelemetry cleanly.

## What this repo does

### Action mode

The action can:

- sample CPU, memory, disk, load, process, and network telemetry during a job
- export metrics to an **OTLP HTTP** endpoint
- optionally export workflow/job traces
- optionally write a markdown job summary
- optionally upload a raw telemetry bundle in `summary-only` mode

### Custom-image mode

For GitHub-hosted larger runners, this repo also includes a custom-image workflow that bakes in:

- `otelcol-contrib`
- pre-job and post-job hooks
- a runtime config renderer

That mode turns the runner image itself into an OpenTelemetry-enabled environment for GitHub Actions jobs.

### Local observability stack

The `observability/` directory includes a local stack with:

- OpenTelemetry Collector
- Prometheus
- Grafana
- optional ngrok tunnel for public OTLP ingestion during demos

## Telemetry emitted by the action

Metric prefix defaults to `github.runner`.

### Core metrics

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

### Resource attributes

Metrics can include workflow context such as:

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

## Quick start

### Runtime compatibility

This action runs on **Node.js 24**.

- JavaScript actions in this repo use the Node 24 runtime
- GitHub-hosted runners are already compatible
- for self-hosted runners, use runner version `v2.327.1` or newer

### 1. Set your OTLP secrets or variables

Set these in your repository or organization:

- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OTEL_EXPORTER_OTLP_HEADERS` (optional)

The endpoint should be the full OTLP HTTP metrics URL.

Examples:

- `https://collector.example.com/v1/metrics`
- vendor OTLP HTTP metrics endpoint

### 2. Add the action to a workflow

```yaml
- name: Export runner telemetry
  uses: ./
  with:
    otlp-endpoint: ${{ secrets.OTEL_EXPORTER_OTLP_ENDPOINT }}
    otlp-headers: ${{ secrets.OTEL_EXPORTER_OTLP_HEADERS }}
    additional-resource-attributes: team=actions,environment=prod
```

Add it early in the job if you want the monitored window to include setup and build time.

### 3. Optional: summary-only mode

If you want local telemetry collection and summary generation without OTLP export:

```yaml
- name: Runner telemetry summary only
  id: telemetry
  uses: ./
  with:
    summary-only: true

- name: Print raw bundle path
  if: always()
  run: echo "Raw bundle path: ${{ steps.telemetry.outputs.raw-bundle-path }}"
```

In `summary-only` mode the action:

- skips OTLP export
- still collects local telemetry
- writes a summary
- uploads a raw telemetry bundle artifact from the `post` step

Artifact name format:

```text
raw-runner-telemetry-<run_id>-<run_attempt>-<job>
```

## Custom-image mode for larger runners

This repo includes `.github/workflows/build-custom-image.yml` for creating a GitHub-hosted larger-runner custom image.

The image installs:

- `otelcol-contrib`
- `/opt/runner/pre-job.sh`
- `/opt/runner/post-job.sh`
- `/opt/runner/render-otel-config.py`

When the image is used on a larger runner, each workflow job automatically:

- starts a runner-local OpenTelemetry Collector before the first workflow step
- scrapes host metrics for the duration of the job
- exports upstream when OTLP configuration is present
- stops the collector after the job completes

Recommended shared org settings for this mode:

- `RUNNER_OTEL_EXPORTER_OTLP_ENDPOINT`
- `RUNNER_OTEL_EXPORTER_OTLP_HEADERS` (optional)
- `RUNNER_OTEL_RESOURCE_ATTRIBUTES` (optional)

Optional metadata variables:

- `RUNNER_OTEL_SERVICE_NAME`
- `RUNNER_OTEL_ENVIRONMENT`
- `RUNNER_OTEL_TEAM`
- `RUNNER_OTEL_CLASS`
- `RUNNER_OTEL_REPO_TYPE`
- `RUNNER_OTEL_BENCHMARK`

Example workflow env:

```yaml
env:
  RUNNER_OTEL_EXPORTER_OTLP_ENDPOINT: ${{ vars.RUNNER_OTEL_EXPORTER_OTLP_ENDPOINT }}
  RUNNER_OTEL_EXPORTER_OTLP_HEADERS: ${{ secrets.RUNNER_OTEL_EXPORTER_OTLP_HEADERS }}
  RUNNER_OTEL_RESOURCE_ATTRIBUTES: >-
    team=actions,environment=prod,runner_class=larger
```

This custom-image mode is useful when you want OpenTelemetry coverage for the whole job without explicitly adding the action step to every workflow.

## Local demo stack

The `observability/` directory provides:

- OpenTelemetry Collector on `4318`
- Prometheus on `9090`
- Grafana on `3000`
- optional ngrok tunnel

### Fastest path

1. Put your ngrok token in `.env`:

```bash
NGROK_AUTHTOKEN=your-ngrok-token
```

2. Start the local stack:

```bash
./scripts/start-local-grafana-stack.sh
```

3. Run the test workflow.

### Manual run

```bash
docker compose -f observability/docker-compose.yml up -d
```

Grafana login:

- user: `admin`
- password: `admin`

To include the public tunnel:

```bash
docker compose -f observability/docker-compose.yml --profile tunnel up -d
```

To stop everything:

```bash
./scripts/stop-local-grafana-stack.sh
```

## Included workflows

### `.github/workflows/ci.yml`

Dogfoods the action in this repository.

### `.github/workflows/test-action.yml`

Exercises the action and summary-only behavior.

### `.github/workflows/compare-runner-sizes.yml`

Compares telemetry across runner types.

### `.github/workflows/build-custom-image.yml`

Builds the larger-runner custom image used for autonomous collector mode.

## Action inputs and outputs

See `action.yml` for the complete contract.

Highlights:

- inputs for OTLP metrics/traces endpoints and headers
- flags for including network/filesystem/load metrics
- flags for enabling traces, summaries, and GitHub API enrichment
- outputs for sample files, summary files, and the raw telemetry bundle

## Development

### Install

```bash
npm ci
```

### Test

```bash
npm test
```

### Build

```bash
npm run build
```

## Scope

This repo is not trying to be a general CI optimization framework or a vendor pitch.

It is an OpenTelemetry-first way to:

- collect telemetry from GitHub Actions jobs
- export it to OTLP-compatible backends
- support both action-based and custom-image-based collection models

That’s the whole thing.
