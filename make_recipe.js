'use strict';

const USERNAME = 'aljedaxi';
const APPENDAGE = 'test';

function BasicSource(sourceName) {
	sourceName = `${sourceName}-${APPENDAGE}`
	return {
		source: `mapbox://tileset-source/${USERNAME}/${sourceName}`,
		minzoom: 4,
		maxzoom: 8
	}
}

function Recipe(layers) {
	return {
		version: 1,
		layers
	}
}

const inFiles = [
	'access_roads.geojson.ld',
	'areas_vw.geojson.ld',
	'avalanche_paths.geojson.ld',
	'decision_points.geojson.ld',
	'points_of_interest.geojson.ld',
	'zones.geojson.ld'
]

const objectify = inFiles => {
	const layers = {};
	inFiles.forEach(file => {
		const name = file.split('.')[0];
		layers[name] = BasicSource(name);
	})
	return layers;
}

const layers = objectify(inFiles);

console.log(
	JSON.stringify(new Recipe(layers), null, 2)
)
