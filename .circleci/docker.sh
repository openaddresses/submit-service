#!/bin/bash
set -u

# collect params from ENV vars
DATE=`date +%Y-%m-%d`
DOCKER_REPOSITORY="openaddr"
DOCKER_PROJECT="${DOCKER_REPOSITORY}/${CIRCLE_PROJECT_REPONAME}"

# skip builds on greenkeeper branches
if [[ -z "${CIRCLE_BRANCH##*greenkeeper*}" ]]; then
	exit 0
fi

DOCKER_BRANCH_IMAGE_VERSION="${CIRCLE_BRANCH}"
DOCKER_BRANCH_IMAGE_NAME="${DOCKER_PROJECT}:${DOCKER_BRANCH_IMAGE_VERSION}"

# the name of the image that represents the "tag", that is an image that is named with the date and git commit and will never be changed
DOCKER_TAG_IMAGE_VERSION="${CIRCLE_BRANCH}-${DATE}-${CIRCLE_SHA1}"
DOCKER_TAG_IMAGE_NAME="${DOCKER_PROJECT}:${DOCKER_TAG_IMAGE_VERSION}"

# build image and login to docker hub
docker build -t $DOCKER_PROJECT .
docker login -u="$DOCKER_USER" -p="$DOCKER_PASS"

# copy the image to each of the two tags, and push
docker tag $DOCKER_PROJECT $DOCKER_BRANCH_IMAGE_NAME
docker tag $DOCKER_PROJECT $DOCKER_TAG_IMAGE_NAME
docker push $DOCKER_BRANCH_IMAGE_NAME
docker push $DOCKER_TAG_IMAGE_NAME
