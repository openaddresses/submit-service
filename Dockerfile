FROM node:8-alpine

# git is needed for JSFTP branch
RUN apk add --no-cache git

# Where the app is built and run inside the docker fs
ENV WORK=/opt/pelias

# Used indirectly for saving logs etc.
ENV HOME=/opt/pelias

WORKDIR ${WORK}

COPY package.json ${WORK}

RUN yarn install --production

COPY . ${WORK}

CMD node index.js
