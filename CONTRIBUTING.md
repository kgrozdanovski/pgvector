# Contributing

The following is a guide towards contributing to the cognirum/pgvector project.
This document describes the typical workflow, the standards, branching strategy and commit message conventions.

## Commit Messages

The commit messages should follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
specification. This enables us to automate the versioning and changelog generation process.

## Merge Request Process

1. Before creating a merge request, make sure that your branch is up-to-date with the target branch.
   This can be done by switching to the target branch and pulling the latest changes from the remote
   repository. Then switch back to your branch and rebase your branch onto the target branch.
2. Ensure that all existing tests pass successfully, including Code Quality and Unit tests.
3. Make sure that the code is properly documented and that the documentation is up-to-date.
4. You may merge the Pull Request in once you have a code review from at least one other developer,
   or if you do not have permission to do that, you may request the second reviewer to merge it for you.

## Versioning

The versioning scheme we use is [SemVer](http://semver.org/) and the format is as follows:
`<major>.<minor>.<patch>`.
The version is automatically bumped by the CI/CD pipeline when a new tag is pushed to the repository.

## Pushing changes to Docker Hub

To push changes to Docker Hub, you must have the Docker engine running on your host machine.

At minimum, you only need to do the following two steps:

1. Build the Docker image
   ```shell
   docker build -t kgrozdanovski/pgvector:18.3-alpine .
   ```
2. Push the Docker image to Docker Hub
   ```shell
   docker push kgrozdanovski/pgvector:18.3-alpine
   ```
