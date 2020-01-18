'use strict';

	/**
	 * @file everything to output database areas as json
	 * @author jacob
	 * @version 0.1
	 */

	/*
	 * jsdoc comments are extra indented because i use indent folding in vi
	 * and i don't want to see the documentation without explicitly unfolding it

	 * after i was told not to use classes, i did some research on the proper,
	 * `javascript' way of doing things; and was told that the gods of yore
	 * never used this and rarely used new. I think the only code that uses this
	 * is Query, because i didn't care enough to fully port it.
	 */

const Readable = require('stream').Readable;
const xml = require('xml');
const xml_parse_string = require('fast-xml-parser').parse;
const Client = require('pg').Client;
const archiver = require('archiver');
const _ = require('ramda');
// let geojsonhint = require('geojsonhint');
const trace = s => {
	console.log(s);
	return s;
};

	/**
	 * @class
	 * @param {string} table								- table to SELECT from
	 * @param {Array}	non_geometry_columns - columns that don't contain geometry
	 * @param {string} where_clause				 - SQL WHERE clause, eg "WHERE area_id=$1"
	 * @param {string} geometry_column			- column with the geometry
	 * @param {Query}	subquery						 - in practice, query to decision_point_warnings from inside decision_points
	 */
function Query(table, non_geometry_columns, where_clause, ogr_type, lang, bounding_box, subquery, geometry_column) {
		/** object mapping from languages to database tables to the names presented to the user 
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
			points_of_interest: "Points d'intérêt",
			access_roads: "Routes d'accès",
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
	this.geometry_transformation;
	this.to_query;
	*/

	switch(ogr_type) {
		case 'KML':
			this.geometry_transformation = 'ST_AsKML';
			break;

		case 'GeoJSON':
		default:
			this.geometry_transformation = 'ST_AsGeoJSON';
			break;
	}

	if (typeof this.geometry_column === 'null') {
		this.to_query = `SELECT ${this.non_geometry_columns.join(', ')} FROM ${this.table} WHERE ${this.where_clause};`;
	} else if (bounding_box) {
			this.to_query = `SELECT ${this.geometry_transformation}(${this.geometry_column}) AS geometry, ${this.geometry_transformation}(ST_Envelope(${this.geometry_column})) AS bounding_box, ${this.non_geometry_columns.join(', ')} FROM ${this.table} WHERE ${this.where_clause};`;
	} else {
		this.to_query = `SELECT ${this.geometry_transformation}(${this.geometry_column}) AS geometry, ${this.non_geometry_columns.join(', ')} FROM ${this.table} WHERE ${this.where_clause};`;
	}
}

	/**
	 * constructor for a query that involves two tables.
	 * @class
	 * @param {Query}	query1			 -- the table to the joined from
	 * @param {Query}	query2			 -- the table to the joined to	??? just read this.to_query it'll make sense
	 * @param {string} join_on			-- FROM ${query1.table} JOIN ${query2.table} ON ${join_on}
	 * @param {string} where_clause -- SQL WHERE clause, without the WHERE
	 * this will probably only work for our specific use case, but i don't think it's worth it to write expansive code here
	 */
function JoinQuery(query1, query2, join_on, where_clause) {
		/**
		 * join non-geometry columns
		 */
	function join_non_geoms(query) {
		const joined_columns_proto = query.non_geometry_columns.join(`, ${query.table}.`);
		const joined_columns = `${query.table}.${joined_columns_proto}`;
		return joined_columns;
	}

	const geometry_column = query1.geometry_column || query2.geometry_column;
	const geometry_transformation = query1.geometry_transformation || query2.geometry_transformation;
	return {
		table: query1.table,
		name: query1.name,
		to_query: `SELECT ${geometry_transformation}(${geometry_column}) AS geometry,
				${join_non_geoms(query1)}, ${join_non_geoms(query2)}
				FROM ${query1.table} JOIN ${query2.table} 
					ON ${join_on}
				WHERE ${where_clause};`
	};
}

	/**
	 * @function query_database
	 * @description get rows from the database, mapped to features
	 * @param	{Query} query_object - Array of Query objects
	 * @param	{number}		 area_id - area_id we're getting data from
	 * @param	{Client}			client - pg {Client} object used to query the database
	 * @return {Promise}							a {Feature} object for each row
	 */
function geojson_query_database(query_object, area_id, client, Feature) {
		/**
		 * @function row_to_feature
		 * @description transform a row into a javascript object into a geojson feature
		 * @return {Feature}
		 */
	function row_to_feature(row) {
		function row_to_object(row) {
			row.table = query_object.table;
			return row;
		}

		function object_to_feature(row, geometry_column) {
			geometry_column = geometry_column || 'geometry';
			const geometry = row[geometry_column];
			const feature_type = row['table'];
			delete row[geometry_column];
			delete row['table'];
			return new Feature(
				geometry,
				feature_type,
				row
			);
		}

		return object_to_feature(row_to_object(row));
	}

	const query = {
		name: `get rows from ${query_object.table}`,
		text: query_object.to_query,
		values: [area_id],
	};

	return new Promise((resolve, reject) => {
		resolve(
			client.query(query)
				.then(res => {
					if (!res) console.error(res);
					return res.rows.map(row_to_feature);
				})
				.catch(e => {
					console.error(e.stack);
					reject(e); //TODO is this a good pattern
				})
		);
	});
}

	/*
	 * @return {Promise}					promises a geojson {FeatureCollection}
	 * @param	{number} area_id
	 * @param	{Client}	client - a pg postgresql client
	 * @param	{Array}	queries - an array of {Query} objects
	 */
function promise_of_geojson(area_id, client, queries, Feature) {
		/**
		 * @param {Array} features - list of the features collected
		 */
	function FeatureCollection(features)	{
		this.type = "FeatureCollection";
		this.features = features;
	}

	function flatten_warnings(warnings) {
		return JSON.stringify(warnings);
	}
		/**
		 * decomposes the garbage the database outputs into digestible warnings
		 * @returns pg rows
		 */

	function warnify(features) {
		//decompose the rows into their geometries and collect the unique ones
		let geometries = Array.from(
			new Set(features.map(f => f.geometry.coordinates.join(', ')))
		);
		geometries = geometries.map(g => g.split(', '));

		const properties = {};
		geometries.forEach(g => {
			properties[g] = {};
			properties[g].warnings = {
				'managing-risk': [],
				'concern': []
			};
		});

		features.forEach(r => {
			try {
				properties[r.geometry.coordinates]['warnings'][r.properties.type].push(r.properties.warning);
				delete r.properties.warning;
				delete r.properties.type;
				for (const key in r.properties) {
					if ({}.hasOwnProperty.call(r.properties, key)) {
						properties[r.geometry.coordinates][key] = r.properties[key];
					}
				}
			} catch (e) {
				console.error(e.stack);
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

	return new Promise((resolve, reject) => {
		const features = [];

		const query_promises = queries.map(query => geojson_query_database(query, area_id, client, Feature));
		Promise.all(query_promises).then(values => {
			values.forEach(querys_features => {
				if (querys_features[0].properties.table === 'decision_points') {
					querys_features = warnify(querys_features);
				}

				querys_features.forEach(
					feature => features.push(feature)
				);
			});
			const collected_features = new FeatureCollection(features);
			resolve(collected_features);
		});
	});
}

	/**
	 * prints geojson to console
	 */
function get_geojson(area_id) {
		/**
		 * @param {JSON} geometry - GeoJSON geometry object
		 * @param {string} feature_type	- the table the feature came from
		 * @param {object} properties		- properties associated with feature. Every column pulled from the table that isn't geometry.
		 */
	function Feature(geometry, feature_type, properties) {
		this.type = "Feature";
		try {
			this.geometry = JSON.parse(geometry);
		} catch (e) {
			console.error('is one of your queries returning KML?');
			console.error(this.geometry);
			console.error(e.stack);
			throw new TypeError("geometry isn't geojson");
		}

		if('bounding_box' in properties) {
			this.bounding_box = properties.bounding_box;
			delete properties.bounding_box;
		}

		if ('type' in properties) {
			properties.type = properties.type.toLowerCase().replace(" ", "-");
		}

		this.properties = properties;
		this.properties.table = feature_type;
	}

	const queries = [
		new Query(
			'areas_vw',
			['id', 'name'],
			'id=$1',
			'GeoJSON',
			'en',
			true
		),
		new Query(
			'points_of_interest',
			['id', 'area_id', 'name', 'type', 'comments'],
			'area_id=$1',
			'GeoJSON'
		),
		new Query(
			'access_roads',
			['id', 'area_id', 'description'],
			'area_id=$1',
			'GeoJSON'
		),
		new Query(
			'avalanche_paths',
			['id', 'area_id', 'name'],
			'area_id=$1',
			'GeoJSON'
		),
		new JoinQuery(
			new Query(
				'decision_points',
				['id', 'name', 'area_id', 'comments'],
				'area_id=$1',
				'GeoJson',
				'en'
			),
			new Query(
				'decision_points_warnings',
				['warning', 'type'],
				'decision_point_id=$1',
				'GeoJson',
				'en',
				false
			),
			'decision_point_id=decision_points.id',
			'decision_points.area_id = $1'
		),
		new Query(
			'zones',
			['id', 'area_id', 'class_code', 'comments'],
			'area_id=$1',
			'GeoJSON',
			'en',
			true
		)
	];

	const client = new Client(); //from require('pg');
	client.connect();

	//{debug} is just a way for me to redirect the output to files
	const debug = true; //TODO set false in production

	promise_of_geojson(area_id, client, queries, Feature)
		.then(geoJsonDoc => {
			client.end();
			//TODO upload to mapbox
			if (debug) {
				console.error(JSON.stringify(geoJsonDoc));
			}
		});
}

	/**
	 * @param {Query}		query_object	-- object describing the database query
	 * @param {number}	 area_id			 -- area_id for WHERE clause in database query
	 * @param {Client}	 client				-- a require('pg') client
	 * @param {function} new_placemark -- a placemark constructor
	 * @returns {Promise} database rows, formatted using {new_placemark}
	 */
function KML_query_database(query_object, area_id, client, new_placemark) {
	/**
		* @function row_to_feature
		* @description transform a feature into an object into a row
		* @return {Feature}
		*/
	function row_to_placemark(row, placemark_constructor) {
		function row_to_object(row) {
			row.table = query_object.table;
			return row;
		}

		function object_to_feature(row) {
				/**
				 * Constructor for geometry objects.
				 * @class
				 * the way the XML parser parses the geometry from the database
				 * is different from the KML pickler; this reformats the geometry
				 * for the pickler
				 */
			function new_geometry(decomposed_geometry) {
				function new_point(point) {
					return {
						Point: [
							{coordinates: point.coordinates}
						]
					};
				}

				function new_linestring(line_string) {
					return {
						LineString: [
							{coordinates: line_string.coordinates}
						]
					};
				}

				function new_polygon(polygon) {
					const general_polygon = {
						Polygon: [{
							outerBoundaryIs: [{
								LinearRing: [
									{coordinates: polygon.outerBoundaryIs.LinearRing.coordinates}
								]
							}]
						}]
					};

					if(polygon.innerBoundaryIs) {
						let inner_boundaries;
						try {
							inner_boundaries = polygon.innerBoundaryIs.map(linear_ring => {
								return {
									LinearRing: [
										{coordinates: linear_ring.LinearRing.coordinates}
									]
								};
							});
						} catch (err) { //TODO can this err be removed?
							inner_boundaries = [
								{LinearRing: [
									{coordinates: polygon.innerBoundaryIs.LinearRing.coordinates}
								]}
							];
						}

						general_polygon.Polygon.push({innerBoundaryIs: inner_boundaries});
						return general_polygon;
					} else {
						return general_polygon;
					}
				}

				if ('Point' in decomposed_geometry) {
					return new_point(decomposed_geometry.Point);
				} else if ('LineString' in decomposed_geometry) {
					return new_linestring(decomposed_geometry.LineString);
				} else if ('Polygon' in decomposed_geometry) {
					return new_polygon(decomposed_geometry.Polygon);
				} else {
					//TODO handle multigeometry
					console.error(decomposed_geometry);
				}
			}

			row.geometry = new_geometry(xml_parse_string(row.geometry));

			if (query_object.table === 'decision_points') {
				return row; //i know it's bad but i can't live like this anymore
			}

			return placemark_constructor(row);
		}

		return object_to_feature(row_to_object(row));
	}

	const query = {
		name: `get rows from ${query_object.table}`,
		text: query_object.to_query,
		values: [area_id],
	};

	return new Promise((resolve, reject) => {
		resolve(
			client.query(query)
				.then(res => { 
					return {
						table: query_object.table,
						name: query_object.name,
						rows: res.rows.map(row => row_to_placemark(row, new_placemark))
					};
				})
				.catch(e => console.error(e.stack))
		);
	});
}

	/**
	 * @param {function} new_placemark -- a placemark constructor
	 * @param {Array} styles -- see styles_for_header
	 * @returns promise of a KML document
	 */
function promise_KML(area_id, client, queries, new_placemark, styles) {
		/**
		 * decomposes the garbage the database outputs into digestible warnings
		 * @returns pg rows
		 */
	function warnify(wrapped_rows) {
			/**
			 * takes the warning parts of the warnings and wraps them in an HTML table
			 * @returns {string} an HTML table , following the google style guide
			 */
		function htmlify(warnings) {
			function tablify(warnings) {
				const concerns = warnings.Concern.map(c => {
					return `<tr> <td><span class="red-x">&#x2717;</span> ${c} </td> </tr>`;
				}).join("\n				");
				const risks = warnings['Managing risk'].map(r => {
					return `<tr> <td><span class="green-check">&#x2717;</span> ${r} </td> </tr> `;
				}).join("\n				");
				return `
					<table class="orange-table">
						<tbody>
							<tr>
								<th class="first">Concern</th>
							</tr>
							${concerns}
							</tr>
							<tr>
							<tr>
								<th>Managing risk</th>
							</tr>
							${risks}
							<tr>
						</tbody>
					</table>
				`;
			}

			const table = tablify(warnings);

			const html = `
				<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">

				<style type="text/css">
				<!--
					.orange-table {
									border: 1px solid black;
									background-color: #FFC000;
									font-size:9.0pt;
									padding: 10px 0;
									width: 333px;
					}
					
					.orange-table td, th {
						padding: 2px 10px;
					}
					
					.orange-table th { 
						font-weight: bold; 
						border-top: 1px solid black; 
						text-align: left; 
					}
					
					.orange-table th.first { border: none; }
					
					.green-check {
						color:#008A00;
						font-size:larger;
						display: block;
						float: left;
						padding-right: 4px;
					}
					.red-x {
						color: red;
						font-size: larger;
						display: block;
						float: left;
						padding-right: 4px;
					}
				-->
				</style>

				${table}
			`;

			return html;
		}

		const rows = wrapped_rows.rows;

		//finds which warnings have unique coords
		const geometries = Array.from(
			new Set(rows.map(r => r.geometry.Point[0].coordinates))
		);

		const warnings = {};
		geometries.forEach(g => {
			warnings[g] = {
				'Managing risk': [],
				'Concern': []
			};
		});
		rows.forEach(r => {
			try {
				warnings[r.geometry.Point[0].coordinates][r.type].push(r.warning);
			} catch (e) {
				console.error(e.stack);
			}
		});
		//decompose the rows into their geometries and collect the unique ones
		const rows_out = geometries.map(geom => {
			return {
				geometry: {
					Point: [
						{coordinates: geom}
					]
				},
				name: 'Decision Point',
				//TODO comments:
				description: htmlify(warnings[geom]),
				table: 'decision_points'
			};
		});
		return rows_out;
	}

	function new_document(name, folders, styles) {
		const doc = folders.map(f => { 
			return {Folder: f}; 
		});
		styles.forEach(s => doc.push(s));
		doc.push({name});
		return [{
			kml: [
				{_attr: {
					'xmlns':		"http://www.opengis.net/kml/2.2",
					'xmlns:gx': "http://www.google.com/kml/ext/2.2"
				}},
				{Document: doc},
				{name}
			]
		}];
	}

	function new_folder(name, features) {
		const folder = features.map(f => {
			return {Placemark: f};
		});
		folder.push({name});
		return folder;
	}

	return new Promise((resolve, reject) => {
		const folders = [];
		let doc_name = '';

		const query_promises = queries.map(query => KML_query_database(query, area_id, client, new_placemark));
		Promise.all(query_promises).then(values => {
			values.forEach(wrapped_querys_rows => {
				if (wrapped_querys_rows.table === 'areas_vw') {
					doc_name = wrapped_querys_rows.rows[0][1].name;
				} else if (wrapped_querys_rows.table === 'decision_points') {
					//TODO make sure the folder is getting its name properly
					wrapped_querys_rows = warnify(wrapped_querys_rows);
					wrapped_querys_rows.rows = wrapped_querys_rows.map(r => new_placemark(r));
				}

				folders.push(
					new_folder(wrapped_querys_rows.name, wrapped_querys_rows.rows)
				);
			});
			const KML_doc = new_document(doc_name, folders, styles);
			resolve(KML_doc);
		}).catch(e => console.error(e.stack));
	});
}

	/**
	 * @param {number} area_id			 -- id of the area whose features you want to query.
	 * @param {string} lang					-- either 'en' (English) or 'fr' (French).
	 * @param {number} icon_number	 -- either 11 or 15; the number associated with the icons. don't know what it means.
	 * @param {string} icon_dir_name -- the prefix for the directory that contains the icons.
	 * contains all the preprocessing necessary to run {promise_KML}
	 * @returns {Promise} promise_KML
	 */
function get_KML(area_id, lang, client, icon_number, icon_dir_name) {
	lang = lang || 'en';
	const LINE_WIDTH = 3; //for LineStyles, in pixels
	const ICON_DIR = `${icon_dir_name}-${icon_number}`;
	const ICON_EXT = 'png';
	const POI_COLOR = '000000ff';

	const style_urls = {
		zones: [
			'filler for slot 0',
			'zone_green_style',
			'zone_blue_style',
			'zone_black_style',
		],
		areas_vw: 'area_styles',
		access_roads: 'access_road_styles',
		avalanche_paths: 'avalanche_path_styles',
		decision_points: 'decision_point_styles',
		points_of_interest: {
			Other: 'point_of_interest_other_styles',
			Parking: 'point_of_interest_parking_styles',
			'Rescue Cache': 'point_of_interest_rescue_cache_styles',
			Cabin: 'point_of_interest_cabin_styles',
			Destination: 'point_of_interest_destination_styles',
			Lake: 'point_of_interest_lake_styles',
			Mountain: 'point_of_interest_mountain_styles'
		}
	};

		/**
		 * i had to write an ungodly amount of code to deal with styling
		 * this function is here to hide all that
		 * @returns {Array} returns an array of Style objects
		 */
	const deal_with_styling = () => {
		const new_Icon = (icon, color) => ({
			Icon: [
				{href: `${ICON_DIR}/new-${icon}-${icon_number}.${ICON_EXT}`},
				{color}
			]
		});

			/**
			 * constructor for KML Style tags
			 * @class
			 */
		const new_Style = (url, styles, style_type) => {
			const reverse = s => s.split('').reverse().join('');
			const basic_style = (style_type, default_stylings) => {
				return styles => {
					//KML uses aabbggrr hex codes, unlike the rest of the civilized world,
					//which uses rrggbbaa. red green blue alpha/transparency
					const re_colored_styles = styles.map(s => ('color' in s) ? {color: reverse(s.color)} : s);
					return {
						[style_type]: default_stylings.concat(re_colored_styles)
					};
				};
			};

			const style_types = {
				LineStyle: basic_style('LineStyle', [{width: LINE_WIDTH}]),
				PolyStyle: basic_style('PolyStyle', []),
				IconStyle: basic_style('IconStyle', [])
			};

			return {
				Style: [
					{_attr: {id: url}},
					style_types[style_type](styles)
				]
			};
		};

		//any color in here is formatted rrggbbaa
		//new_Style reverses it for kml
		const styles = {
			zones: [
				new_Style(style_urls.zones[1], [
					{color: '55ff0088'} //green
				], 'PolyStyle'),
				new_Style(style_urls.zones[2], [
					{color: '0000ff88'} //blue
				], 'PolyStyle'),
				new_Style(style_urls.zones[3], [
					{color: '00000088'} //black
				], 'PolyStyle')
			],
			areas_vw: new_Style(style_urls.areas_vw, [
				{color: '00000000'} //fully transparent
			], 'PolyStyle'),
			access_roads: new_Style(style_urls.access_roads, [
				{color: 'ffff00ff'}, //yellow
				{'gx:outerColor': 'ff00ff00'}, //green
				{'gx:outerWidth': LINE_WIDTH + 5} //TODO isn't working but isn't important
			], 'LineStyle'),
			avalanche_paths: new_Style(style_urls.avalanche_paths, [
				{color: 'ff0000ff'}
			], 'LineStyle'),
			decision_points: new_Style(style_urls.decision_points, [
				{color: 'ff0000ff'},
				new_Icon('cross', 'ff0000ff')
			], 'IconStyle'),
			points_of_interest: {
				Other: new_Style(style_urls.points_of_interest.Other, [
					{color: POI_COLOR},
					new_Icon('marker', POI_COLOR)
				], 'IconStyle'),
				Parking: new_Style(style_urls.points_of_interest.Parking, [
					{color: POI_COLOR},
					new_Icon('parking', POI_COLOR)
				], 'IconStyle'),
				'Rescue Cache': new_Style(style_urls.points_of_interest['Rescue Cache'], [
					{color: POI_COLOR},
					new_Icon('blood-bank', POI_COLOR)
				], 'IconStyle'),
				Cabin: new_Style(style_urls.points_of_interest.Cabin, [
					{color: POI_COLOR},
					new_Icon('shelter', POI_COLOR)
				], 'IconStyle'),
				Destination: new_Style(style_urls.points_of_interest.Destination, [
					{color: POI_COLOR},
					new_Icon('attraction', POI_COLOR)
				], 'IconStyle'),
				Lake: new_Style(style_urls.points_of_interest.Lake, [
					{color: POI_COLOR},
					new_Icon('water', POI_COLOR)
				], 'IconStyle'),
				Mountain: new_Style(style_urls.points_of_interest.Mountain, [
					{color: POI_COLOR},
					new_Icon('mountain', POI_COLOR)
				], 'IconStyle'),
			}
		};

		const flatten_styles = styles => {
			const flat_styles = [];
			_.values(styles).forEach(s => {
				if (s.Style) {
					flat_styles.push(s);
				} else if (Array.isArray(s)) {
					s.forEach(x => flat_styles.push(x));
				} else {
					_.values(s).forEach(x => flat_styles.push(x));
				}
			});
			return flat_styles;
		};

		return flatten_styles(styles);
	};

	const styles_for_header = deal_with_styling();


	const new_placemark = style_urls => row => {
		function extend_data(placemark, extension, data) {
			let extended = 0;
			let i = 0;
			for (const obj of placemark) {
				i++;
				if ('ExtendedData' in obj) {
					extended = i;
					break;
				}
			}

			if (extended) {
				placemark[extended].push(
					{[extension]: data}
				);
			} else {
				placemark.push({
					ExtendedData: [
						{[extension]: data}
					]
				});
			}
		}

		function describe(placemark, description) {
			placemark.push({description});
		}

		const table = row.table;
		const geometry = row.geometry;
		const name = row.name;
		const comments = row.comments;
		const class_code = row.class_code;
		const type = row.type;
		const description = row.description;
		const warnings = row.warnings;
		let styleUrl;

		const placemark = [];
		placemark.push(geometry);
		if (name) {
			placemark.push({name});
		}

		if (comments) {
			describe(placemark, comments);
		}

		if (description) {
			describe(placemark, description);
		}

		if (type) {
			describe(placemark, type);
			styleUrl = style_urls[table][type];
		}

		if (warnings) {
			extend_data(placemark, 'warnings', warnings);
		}

		if (class_code) {
			extend_data(placemark, 'class_code', class_code);
			styleUrl = style_urls[table][class_code];
		}

		styleUrl = styleUrl || style_urls[table];
		placemark.push({styleUrl: `#${styleUrl}`});
		return placemark;
	};

	const newer_placemark = new_placemark(style_urls);

	const queries = [
		new Query(
			'areas_vw',
			['name'],
			'id=$1',
			'KML',
			lang
		),
		new Query(
			'points_of_interest',
			['name', 'type', 'comments'],
			'area_id=$1',
			'KML',
			lang
		),
		new Query(
			'access_roads',
			['description'],
			'area_id=$1',
			'KML',
			lang
		),
		new Query(
			'avalanche_paths',
			['name'],
			'area_id=$1',
			'KML',
			lang
		),
		new JoinQuery(
			new Query(
				'decision_points',
				['name', 'comments'],
				'area_id=$1',
				'KML',
				lang
			),
			new Query(
				'decision_points_warnings',
				['warning', 'type'],
				'decision_point_id=$1',
				undefined,
				undefined,
				undefined,
				undefined,
				null
			),
			'decision_point_id=decision_points.id',
			'decision_points.area_id = $1'
		),
		new Query(
			'zones',
			['class_code', 'comments'],
			'area_id=$1',
			'KML',
			lang
		)
	];

	return promise_KML(area_id, client, queries, newer_placemark, styles_for_header);
}

	/**
	 * @param {number} icon_number		 -- either 11 or 15; the number associated with the icons. don't know what it means.
	 * @param {string} icon_dir				-- the prefix for the directory that contains the icons.
	 * @param {Writable} output_stream -- stream to which the KMZ is written
	 * @returns {Writable} output_stream, the same one as the input
	 */
function make_KMZ_stream(area_id, lang, output_stream, res, icon_number, icon_dir) {
	function write_to_kmz(kml, output) {
		const kml_stream = new Readable();
		kml_stream.push(kml);
		kml_stream.push(null);

		const archive = archiver('zip', {
			zlib: {level: 9}
		});
		archive.on('warning', err => {
			if (err.code === 'ENOENT') {
				console.error(err);
			} else {
				throw err;
			}
		});
		archive.on('error', err => {
			console.error(err);
			throw err;
		});
		archive.pipe(output);
		archive.append(kml_stream, {name: 'doc.kml'});
		archive.directory(`${icon_dir}-${icon_number}/`, `${icon_dir}-${icon_number}`);
		archive.finalize();
		return output;
	}

	const client = new Client(); //from require('pg');
	client.connect();

	//11 or 15 are the two valid sizes for icons
	icon_number = icon_number || [11, 15][0]; 
	console.assert(icon_number in {11: 11, 15: 15});
	icon_dir = icon_dir || 'files'; 
	console.assert(lang in {en: 'en', fr: 'fr'});

	//write directly to file
	//const output = fs.createWriteStream(`./${area_id}.kmz`);
	//write to stream
	//let buff_array = [];
	//const output = new Writable({
	//	write(chunk, encoding, callback) {
	//		buff_array.push(chunk);
	//		console.log(buff_array);
	//		callback();
	//	}
	//});

	console.log('promising');
	return new Promise((resolve, reject) => {
		get_KML(area_id, lang, client, icon_number, icon_dir)
			.then(kml => {
				console.log('kmled');
				client.end();
				res.attachment(`${kml[0].kml[2].name}.kmz`);
				write_to_kmz(xml(kml), output_stream, icon_number, icon_dir);
			});
		resolve(output_stream);
	});
}

function KML_express_app_wrappy_thing() {
	const app = require('express')();

	app.get('/:lang/:areaId.kmz', (req, res) => {
		const areaId = req.params.areaId;
		const lang = req.params.lang;
		trace(areaId, lang);
		res.attachment(`${areaId}.kmz`);
		const output = res;
		make_KMZ_stream(areaId, lang, output, res)
			.then(r => {
				console.log(r);
			});
	});
	trace('dab')
	app.listen(3000);
}

const areaId = 401;

// get_geojson(areaId);
KML_express_app_wrappy_thing();
