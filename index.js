const _ = require('lodash');

try {
  if (_.isEmpty(process.env.GITHUB_ACCESS_TOKEN)) {
    throw Error('GITHUB_ACCESS_TOKEN is required');
  }
  if (_.isEmpty(process.env.S3_ACCESS_KEY_ID)) {
    throw Error('S3_ACCESS_KEY_ID is required');
  }
  if (_.isEmpty(process.env.S3_SECRET_ACCESS_KEY)) {
    throw Error('S3_SECRET_ACCESS_KEY is required');
  }

  const app = require('./app')({
    githubAccessToken: process.env.GITHUB_ACCESS_TOKEN,
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY
  });

  const port = ( parseInt(process.env.PORT) || 3103 );

  app.listen(port, () => {
    console.log(`submit-service is now running on port ${port}`);
  });

} catch (err) {
  console.error(err.toString());
  process.exit(1);

}
