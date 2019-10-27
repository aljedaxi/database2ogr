'use strict';

const fs = require('fs');
/*
Const mbxUploads = require('@mapbox/mapbox-sdk/services/uploads');
const uploadsClient = mbxUploads({accessToken: process.env.TOKEN});
const AWS = require('aws-sdk');
*/
const {Client} = require('pg');
const _ = require('ramda');

const ownerId = process.env.USERNAME;
const TEST_DATA_PATH = 'populated_places.geojson.ld';

function Query(table, non_geometry_columns, where_clause, ogr_type, lang, bounding_box, subquery, geometry_column) {
	/** Object mapping from languages to database tables to the names presented to the user
		 */
	const names = {
		en: {
			areas_vw: 'Area',
			points_of_interest: 'Points of interest',
			access_roads: 'Access road',
			avalanche_paths: 'Avalanche path',
			decision_points: 'Decision point',
			zones: 'Zone'
		},
		fr: {
			areas_vw: 'Régions',
			points_of_interest: 'Points d\'intérêt',
			access_roads: 'Routes d\'accès',
			avalanche_paths: 'Couloirs d’avalanche',
			decision_points: 'point de décision',
			zones: 'Zone'
		}
	};

	this.table = table;
	this.non_geometry_columns = non_geometry_columns;
	this.where_clause = where_clause;
	this.subquery = subquery;
	this.ogr_type = ogr_type;
	this.geometry_column = (typeof geometry_column === 'null') ? null : 'geom';
	this.bounding_box = typeof bounding_box !== 'undefined' ? bounding_box : false;
	this.lang = lang || 'en';
	this.name = names[this.lang][table];
	/*
	This.geometry_transformation;
	this.to_query;
	*/

	switch (ogr_type) {
		case 'KML':
			this.geometry_transformation = 'ST_AsKML';
			break;

		case 'GeoJSON':
		default:
			this.geometry_transformation = 'ST_AsGeoJSON';
			break;
	}

	if (typeof this.geometry_column === 'null') {
		this.to_query = `SELECT ${this.non_geometry_columns.join(', ')} FROM ${this.table}`;
	} else if (bounding_box) {
		this.to_query = `SELECT ${this.geometry_transformation}(${this.geometry_column}) AS geometry, ${this.geometry_transformation}(ST_Envelope(${this.geometry_column})) AS bounding_box, ${this.non_geometry_columns.join(', ')} FROM ${this.table}`;
	} else {
		this.to_query = `SELECT ${this.geometry_transformation}(${this.geometry_column}) AS geometry, ${this.non_geometry_columns.join(', ')} FROM ${this.table}`;
	}

	if (this.where_clause) {
		this.to_query += ` WHERE ${this.where_clause};`;
	} else {
		this.to_query += ';';
	}
}

/**
	 * Constructor for a query that involves two tables.
	 * @class
	 * @param {Query}	query1			 -- the table to the joined from
	 * @param {Query}	query2			 -- the table to the joined to	??? just read this.to_query it'll make sense
	 * @param {string} join_on			-- FROM ${query1.table} JOIN ${query2.table} ON ${join_on}
	 * @param {string} where_clause -- SQL WHERE clause, without the WHERE
	 * this will probably only work for our specific use case, but i don't think it's worth it to write expansive code here
	 */
function JoinQuery(query1, query2, join_on, where_clause) {
	/**
		 * Join non-geometry columns
		 */
	function join_non_geoms(query) {
		const joined_columns_proto = query.non_geometry_columns.join(`, ${query.table}.`);
		const joined_columns = `${query.table}.${joined_columns_proto}`;
		return joined_columns;
	}

	function makeQuery(whereClause) {
		if (where_clause) {
		  return `SELECT ${geometry_transformation}(${geometry_column}) AS geometry,
				${join_non_geoms(query1)}, ${join_non_geoms(query2)}
				FROM ${query1.table} JOIN ${query2.table} 
					ON ${join_on}
				WHERE ${where_clause};`;
		}

		return `SELECT ${geometry_transformation}(${geometry_column}) AS geometry,
				${join_non_geoms(query1)}, ${join_non_geoms(query2)}
				FROM ${query1.table} JOIN ${query2.table} 
					ON ${join_on};`;
	}

	const geometry_column = query1.geometry_column || query2.geometry_column;
	const geometry_transformation = query1.geometry_transformation || query2.geometry_transformation;

	const to_query = makeQuery(where_clause);

	return {
		table: query1.table,
		name: query1.name,
		to_query
	};
}

function queryDatabase(queryObject, client, Feature) {
	/**
		 * @function row_to_feature
		 * @description transform a row into a javascript object into a geojson feature
		 * @return {Feature}
		 */
	function row_to_feature(row) {
		function row_to_object(row) {
			row.table = queryObject.table;
			return row;
		}

		function object_to_feature(row, geometry_column) {
			geometry_column = geometry_column || 'geometry';
			const geometry = row[geometry_column];
			const feature_type = row.table;
			delete row[geometry_column];
			delete row.table;
			return new Feature(
				geometry,
				feature_type,
				row
			);
		}

		return object_to_feature(row_to_object(row));
	}

	const query = {
		name: `get rows from ${queryObject.table}`,
		text: queryObject.to_query
	};

	return new Promise((resolve, reject) => {
		resolve(
			client.query(query)
				.then(res => {
					if (!res) {
						console.error(res);
					}

					return res.rows.map(row_to_feature);
				})
				.catch(error => {
					console.log(query);
					console.error(error.stack);
					reject(error); // TODO is this a good pattern
				})
		);
	});
}

/**
	* @param {string} outFolder - folder for geoJSON 
	*/
function getGeoJSONLD(outFolder) {
	const queries = [
		new Query(
			'areas_vw',
			['id', 'name'],
			null,
			'GeoJSON',
			'en',
			true
		),
		new Query(
			'points_of_interest',
			['id', 'area_id', 'name', 'type', 'comments'],
			null,
			'GeoJSON'
		),
		new Query(
			'access_roads',
			['id', 'area_id', 'description'],
			null,
			'GeoJSON'
		),
		new Query(
			'avalanche_paths',
			['id', 'area_id', 'name'],
			null,
			'GeoJSON'
		),
		new JoinQuery(
			new Query(
				'decision_points',
				['id', 'name', 'area_id', 'comments'],
				null,
				'GeoJson',
				'en'
			),
			new Query(
				'decision_points_warnings',
				['warning', 'type'],
				null,
				'GeoJson',
				'en',
				false
			),
			'decision_points_warnings.decision_point_id=decision_points.id',
			null
		),
		new Query(
			'zones',
			['id', 'area_id', 'class_code', 'comments'],
			null,
			'GeoJSON',
			'en',
			true
		)
	];

	function Feature(geometry, feature_type, properties) {
		this.type = 'Feature';
		try {
			this.geometry = JSON.parse(geometry);
		} catch (error) {
			console.error('is one of your queries returning KML?');
			console.error(this.geometry);
			console.error(error.stack);
			throw new TypeError('geometry isn\'t geojson');
		}

		if ('bounding_box' in properties) {
			this.bounding_box = properties.bounding_box;
			delete properties.bounding_box;
		}

		if ('type' in properties) {
			properties.type = properties.type.toLowerCase().replace(' ', '-');
		}

		this.properties = properties;
		this.properties.table = feature_type;
	}

	function FeatureCollection(features)	{
		this.type = 'FeatureCollection';
		this.features = features;
	}

	function flatten_warnings(warnings) {
		return JSON.stringify(warnings);
	}

		/**
		 * Decomposes the garbage the database outputs into digestible warnings
		 * @returns pg rows
		 */
	function warnify(features) {
		// Decompose the rows into their geometries and collect the unique ones
		let geometries = [...new Set(features.map(f => f.geometry.coordinates.join(', ')))];
		geometries = geometries.map(g => g.split(', '));

		const properties = {};
		geometries.forEach(g => {
			properties[g] = {};
			properties[g].warnings = {
				'managing-risk': [],
				concern: []
			};
		});

		features.forEach(r => {
			try {
				properties[r.geometry.coordinates].warnings[r.properties.type].push(r.properties.warning);
				delete r.properties.warning;
				delete r.properties.type;
				for (const key in r.properties) {
					if ({}.hasOwnProperty.call(r.properties, key)) {
						properties[r.geometry.coordinates][key] = r.properties[key];
					}
				}
			} catch (error) {
				console.error(error.stack);
			}
		});

		for (const g in properties) {
			properties[g].warnings = flatten_warnings(properties[g].warnings);
		}

		const rows_out = geometries.map(geom => {
			return new Feature(
				JSON.stringify({
					type: 'Point',
					coordinates: geom.map(g => Number.parseFloat(g))
				}),
				'decision_points',
				properties[geom]
			);
		});

		return rows_out;
	}

	const client = new Client(); // From require('pg');
	client.connect();

	new Promise((resolve, reject) => {
		const query_promises = queries.map(query => queryDatabase(query, client, Feature));
		Promise.all(query_promises).then(values => {
			values.forEach(querys_features => {
				if (querys_features[0].properties.table === 'decision_points') {
					querys_features = warnify(querys_features);
				}

				const output = fs.createWriteStream(
					`${outFolder}/${querys_features[0].properties.table}`
				);

				const writeToOutput = _.compose(
					output.write.bind(output),
					JSON.stringify
				);

				querys_features.forEach(writeToOutput);
			});
		});
		resolve(true);
	}).then(client.close);
}


const outFolder = process.argv.pop() || 'geojson-ld';
getGeoJSONLD(outFolder);

/*
	UploadsClient.listUploads()
		.send()
		.then(r => console.log(r.body));
	//* /
	/*

	//You'll be doing tilesets.forEach(tileset => the_below)
	const tileset = {
		name: 'test',
		path: TEST_DATA_PATH
	};

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
			Body: fs.createReadStream(tileset.path)
		}).promise();
	};

	const putFileOnMapbox = (credentials) => {
		return uploadsClient.createUpload({
			mapId: `${ownerId}.${tileset.name}`,
			url: credentials.url
		})
			.send()
			.then(console.log)
			.catch(console.error);
	}

	getCredentials()
		.then(creds => {
			putFileOnS3(creds)
				.then(dunno => {
					putFileOnMapbox(creds)
				})
				.catch(console.error);
		})
		.catch(console.error);

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
