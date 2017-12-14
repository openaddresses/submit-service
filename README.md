# OpenAddress Submit Service

[![Greenkeeper badge](https://badges.greenkeeper.io/openaddresses/submit-service.svg)](https://greenkeeper.io/)

This project provides an HTTP service that can be used to back a website that makes submitting new data sources to OpenAddresses easier for those unfamiliar with JSON and github.

## Usage

While the service can be run directly from node, the preferred method is using docker.

To run using docker, enter:

```bash
$ docker-compose up
```

The service starts on [http://localhost:3103](http://localhost:3103) (unless the port is overridden).

### Credentials

This service performs operations on github and uploads file to s3, so the credentials for both of these services must be available in the docker environment.  Docker uses the .env file to store these values.  For security concerns, the .env file is not stored in the git repository and must be populated before running docker.  A sample .env file is:

```bash
GITHUB_ACCESS_TOKEN=<github access token>
AWS_ACCESS_KEY_ID=<AWS access key id>
AWS_SECRET_ACCESS_KEY=<AWS secret access key>
```

## Endpoints

The service exposes two endpoints for programmatic access:

- `/sample`: looks up the field names and first 10 records from a source
- `/submit`: submits a pull request to the OpenAddresses repo

### `/sample`

The `/sample` endpoint accepts a single parameter named `source`.  The response format is the basic shell of an OpenAddresses source, for example [York County, PA, USA](http://arcweb.ycpc.org/arcgis/rest/services/Emergency_Services/Address_Pts/MapServer/0).  

An example response from the `/sample` endpoint is:

```json
{
	"coverage": {},
	"type": "ESRI",
	"data": "http://arcweb.ycpc.org/arcgis/rest/services/Emergency_Services/Address_Pts/MapServer/0",
	"conform": {
		"type": "geojson"
	},
	"source_data": {
		"fields": ["id", "number", "street", "city"],
		"results": [
			{
				"id": "1001",
				"number": "123",
				"street": "Main Street",
				"city": "Anytown"
			},
			{
				"id": "1002",
				"number": "17",
				"street": "Maple Avenue",
				"city": "Somewheresville"
			}
		]
	}
}
```

The populated portions would be properties that can be inferred from the source:

- `type`: (either `ESRI`, `http`, or `ftp`)
- `conform.type`: (one of `geojson`, `csv`, or `shapefile`)
- `compression`: (`zip` is source is a .zip file)
- `data` (the value of the `source` parameter)

### `/submit`

TBD

## Supported Types

There are several supported source types:

- ESRI/Arcgis
- CSV (optionally .zip compressed)
- GeoJSON (optionally .zip compressed)
- Shapefiles (.zip compressed)

## Development

### Local Testing

For local testing, the service also provides a [UI](http://localhost:3103/) that can query the service and display the output in HTML.

### Running Unit Tests

```bash
$ npm test
```

## Contributing

Please fork and pull request against upstream master on a feature branch.

Provide unit tests in the `test` directory.

## Continuous Integration

Travis tests every release against Node.js version `8`.

[![Build Status](https://travis-ci.org/openaddresses/submit-service.png?branch=master)](https://travis-ci.org/openaddresses/submit-service)
