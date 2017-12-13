# OpenAddress Submit Service

[![Greenkeeper badge](https://badges.greenkeeper.io/openaddresses/submit-service.svg)](https://greenkeeper.io/)

This project provides an HTTP service that can be used to back a website that makes submitting new data sources to OpenAddresses easier for those unfamiliar with JSON and github.


## Usage

The service can be run in two ways:

- Docker
- node.js

In either scenario, the service starts on [http://localhost:3103](http://localhost:3103) (unless the port is overridden).

### Docker

To run using docker on port 3103, install docker and run:

```bash
$ docker run -p 3103:3103 openaddr/submit-service:master
```

### node.js

To run using node.js and npm, simply enter the following to install dependencies and start the service:

```bash
$ npm install
$ npm start
```

By default, the service starts on port 3103, but this can be changed by setting the `PORT` environmental variable.

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
