Convenient Docker images for Postgres images with pre-installed pgvector extension.

The goal is to simplify and speed-up image building on local and especially CI/CD environments.

All image variants are based on their official equivalents.

## Quick reference

#### Maintained by:

Kristijan Grozdanovski

Visit the GitHub [repository](https://github.com/kgrozdanovski/pgvector) for this project

#### Where to get help:

The Docker Community Slack, Server Fault, Unix & Linux, or Stack Overflow

#### Supported tags and respective Dockerfile links

<!-- BEGIN GENERATED POSTGRES TAGS -->
* `latest`, `18`, `18.3`, `18-alpine`, `18.3-alpine`, `18-bookworm`, `18.3-bookworm`, `18-trixie`, `18.3-trixie`
* `17`, `17.9`, `17-alpine`, `17.9-alpine`, `17-bookworm`, `17.9-bookworm`, `17-trixie`, `17.9-trixie`
* `16`, `16.13`, `16-alpine`, `16.13-alpine`, `16-bookworm`, `16.13-bookworm`, `16-trixie`, `16.13-trixie`
* `15`, `15.17`, `15-alpine`, `15.17-alpine`, `15-bookworm`, `15.17-bookworm`, `15-trixie`, `15.17-trixie`
* `14`, `14.22`, `14-alpine`, `14.22-alpine`, `14-bookworm`, `14.22-bookworm`, `14-trixie`, `14.22-trixie`
* `13`, `13.23`, `13-alpine`, `13.23-alpine`, `13-bookworm`, `13.23-bookworm`
* `12`, `12.22`, `12-alpine`, `12.22-alpine`, `12-bookworm`, `12.22-bookworm`, `12-bullseye`, `12.22-bullseye`
<!-- END GENERATED POSTGRES TAGS -->

#### Where to file issues:

https://github.com/kgrozdanovski/pgvector/issues

## What is pgvector?

pgvector is a PostgreSQL extension for vector similarity search. It enables efficient storage, indexing and similarity
searching for high-dimensional vector embeddings directly within the Postgres database.

Read more [here](https://github.com/pgvector/pgvector).

## How to use this image

These images are drop-in replacements for their official Docker counterparts. Simply use these images as base images
in your Dockerfile or Docker Compose specification, for example:

```yaml
database:
  image: kgrozdanovski/pgvector:18.3-alpine
  restart: always
  environment:
    POSTGRES_USER=db_user
    POSTGRES_PASSWORD=db_password
    POSTGRES_DB=db_name
  volumes:
    - db-virtual-volume:/var/lib/postgresql/data:rw # persist data even if container shuts down
  ports:
    - "127.0.0.1:5432:5432"
```

## Image Variants

My goal is to provide images for all flavors found in the [official repo](https://hub.docker.com/_/postgres) which make sense
to me - currently this includes Base, Alpine and Bookworm variants for Postgres 12+, Bullseye for Postgres 12, plus Trixie for Postgres 14+.
