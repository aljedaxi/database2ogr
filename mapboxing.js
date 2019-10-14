'use strict';

const mbxUploads = require('@mapbox/mapbox-sdk/services/uploads');
const uploadsClient = mbxUploads({accessToken: process.env.TOKEN});
const AWS = require('aws-sdk');

const ownerId = process.env.USERNAME;
const TEST_DATA_PATH = 'test.geojson';

console.log(process.env.USERNAME);
console.log(process.env.TOKEN);

const getCredentials = () => {
  return uploadsClient
    .createUploadCredentials()
    .send()
    .then(response => response.body);
};

const putFileOnS3 = (credentials) => {
  const s3 = new AWS.S3({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    sessionToken: credentials.sessionToken,
    region: 'us-east-1'
  });
  return s3.putObject({
    Bucket: credentials.bucket,
    Key: credentials.key,
    Body: fs.createReadStream(TEST_DATA_PATH)
  }).promise();
};

getCredentials()
	.then(putFileOnS3)
	.catch(console.error);


/*
Function upload_to_mapbox(geojson_doc, area_id) {
	const MY_ACCESS_TOKEN = 'testest'; //TODO
	const USERNAME = 'testest'; //TODO
	const AWS = require('aws-sdk'); //TODO move to top
	const mbxUploads = require('@mapbox/mapbox-sdk/services/uploads');
	const uploadsClient = mbxClient({accessToken: MY_ACCESS_TOKEN});
	const region = 'us-east-1';
	const geojson_stream = new Readable();
	geojson_stream.push(geojson_doc);
	geojson_stream.push(null);

	const getCredentials = () => {
		return uploadsClient
			.createUploadCredentials()
			.send()
			.then(response => response.body);
	};

	const putFileOnS3 = (credentials) => {
		const s3 = new AWS.S3({
			accessKeyId = credentials.accessKeyId,
			secretAccessKey = credentials.secretAccessKey,
			sessionToken = credentials.sessionToken,
			region: REGION
		});
		return s3.putObject({
			Bucket: credentials.bucket,
			Key: credentials.key,
			//Body: fs.createReadStream(GEOJSON_FILE_PATH)
			Body: geojson_stream
		}).promise();
	};

	getCredentials()
		.then(creds => {
			putFileOnS3(creds)
				.then(dunno => {
					uploadsClient.createUpload({
						mapId: `${USERNAME}.${area_id}`, //TODO
						url: creds.url
					})
						.send()
						.then(response => {
							const upload = response.body;
						});
				});
		}); //test for failure
}
*/

