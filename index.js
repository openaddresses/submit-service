try {
  const app = require('./app')(process.argv[2]);
  const port = ( parseInt(process.env.PORT) || 3103 );

  app.listen(port, () => {
    console.log(`mod-service is now running on port ${port}`);
  });

} catch (err) {
  console.error(err);
  process.exit(1);

}
