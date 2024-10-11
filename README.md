Convenient Docker images for Postgres images with pre-installed pgvector extension.

The goal is to simplify and speed-up image building on local and especially CI/CD environments.

All image variants are based on their official equivalents.

## Quick reference

#### Maintained by:

KSI Software & Partners

Visit the GitHub [repository](https://github.com/ksi-software/pgvector) for this project

#### Where to get help:

the Docker Community Slack, Server Fault, Unix & Linux, or Stack Overflow

#### Supported tags and respective Dockerfile links

**Current**: `ksisoft/pgvector:16.3-alpine`
**Planned**: `ksisoft/pgvector:16.2-alpine`, `ksisoft/pgvector:16.3` etc.

#### Where to file issues:

https://github.com/ksi-software/pgvector/issues

## What is pgvector?

pgvector is a PostgreSQL extension for vector similarity search. It can also be used for storing embeddings.

Read more [here](https://github.com/pgvector/pgvector).

## How to use this image

Our images are drop-in replacements for their official Docker counterparts. Simply use these images as base images
in your Dockerfile or Docker Compose specification:

```yaml
database:
  image: ksisoft/pgvector:16.3-alpine
```

## Image Variants

At the moment, the only variant offered is the Alpine image, which significantly speeds up local builds and
pipelines which build Docker images.

We aim to provide images for all flavors found in the [official repo](https://hub.docker.com/_/postgres) which make sense
to us - currently this includes all Base, Alpine and Bullseye major versions for Postgres 12+.
