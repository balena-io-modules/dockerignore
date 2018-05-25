# Just to run tests
FROM mhart/alpine-node:9 AS base
RUN apk --update --no-cache add bash make docker
WORKDIR /usr/src/app
COPY . ./
ARG CI=false
ENV CI=$CI
RUN yarn install
RUN yarn test-ci