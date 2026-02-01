# Workers Analytics Engine Query Guide

This guide explains how to query your Workers Analytics Engine data using ClickHouse SQL.

## Quick Start

### 1. Get Your Dataset Names

First, find out what datasets you have:

```bash
curl "https://api.cloudflare.com/client/v4/accounts/{account_id}/analytics_engine/sql" \
  --header "Authorization: Bearer <API_TOKEN>" \
  --data "SHOW TABLES"
```

### 2. Run a Query

```bash
curl "https://api.cloudflare.com/client/v4/accounts/{account_id}/analytics_engine/sql" \
  --header "Authorization: Bearer <API_TOKEN>" \
  --data "SELECT * FROM asset_service LIMIT 10"
```

## Data Schema

### Asset-Service Worker Dataset (`asset_service`)

| Column             | Type     | Description                     |
| ------------------ | -------- | ------------------------------- |
| `timestamp`        | DateTime | When the event was logged       |
| `index1`           | string   | Project ID (sampling key)       |
| `_sample_interval` | integer  | Sample rate multiplier          |
| `double1`          | double   | Request time (milliseconds)     |
| `double2`          | double   | HTTP status code                |
| `double3`          | double   | Asset fetch time (milliseconds) |
| `blob1`            | string   | Hostname                        |
| `blob2`            | string   | User agent                      |
| `blob3`            | string   | HTML handling option            |
| `blob4`            | string   | Not found handling option       |
| `blob5`            | string   | Error message                   |
| `blob6`            | string   | Worker version                  |
| `blob7`            | string   | Colo region                     |
| `blob8`            | string   | Cache status                    |

### Router Worker Dataset (`router`)

| Column             | Type     | Description                 |
| ------------------ | -------- | --------------------------- |
| `timestamp`        | DateTime | When the event was logged   |
| `index1`           | string   | Project ID (sampling key)   |
| `_sample_interval` | integer  | Sample rate multiplier      |
| `double1`          | double   | Request time (milliseconds) |
| `double2`          | double   | HTTP status code            |
| `blob1`            | string   | Hostname                    |
| `blob2`            | string   | User agent                  |
| `blob3`            | string   | Request pathname            |
| `blob4`            | string   | Error message               |
| `blob5`            | string   | Colo region                 |
| `blob6`            | string   | Routing type                |
| `blob7`            | string   | HTTP method                 |
| `blob8`            | string   | Request type                |
| `blob9`            | string   | Worker version              |

## Common Query Patterns

### 1. Sampling-Aware Averages

```sql
SELECT
  SUM(_sample_interval * double1) / SUM(_sample_interval) AS avg_request_time
FROM asset_service
WHERE double1 > 0;
```

### 2. Time Series Aggregation

```sql
SELECT
  intDiv(toUInt32(timestamp), 300) * 300 AS time_bucket,
  COUNT() * AVG(_sample_interval) AS request_count
FROM asset_service
WHERE timestamp >= NOW() - INTERVAL '1' DAY
GROUP BY time_bucket
ORDER BY time_bucket;
```

### 3. Percentiles (Sampling-Aware)

**Use `quantileExactWeighted()` for proper sampling:**

```sql
SELECT
  quantileExactWeighted(0.50)(double1, _sample_interval) AS p50_ms,
  quantileExactWeighted(0.95)(double1, _sample_interval) AS p95_ms,
  quantileExactWeighted(0.99)(double1, _sample_interval) AS p99_ms
FROM asset_service
WHERE timestamp >= NOW() - INTERVAL '1' DAY
  AND double1 > 0;
```

## SQL Limitations

### Not Supported

- ❌ **Window functions** - `OVER (PARTITION BY ...)`
- ❌ **Subqueries in SELECT** - `SELECT (SELECT ...) AS col`
- ❌ **JOIN operations**
- ❌ **UNION operations**
- ❌ **quantile()** - Use `quantileExactWeighted()` instead

### Correct Function

✅ **Use this for percentiles:**

```sql
quantileExactWeighted(q)(column_name, _sample_interval)
```

## Resources

- [Workers Analytics Engine Docs](https://developers.cloudflare.com/analytics/analytics-engine/)
- [SQL Reference](https://developers.cloudflare.com/analytics/analytics-engine/sql-reference/)
- [Aggregate Functions](https://developers.cloudflare.com/analytics/analytics-engine/sql-reference/aggregate-functions/)
