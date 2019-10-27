'use strict';

const TILESET_NAME = process.argv[2] || 'test';
const SOURCE_IDS_IN = process.argv[3].split(' ').filter(notBlankP);

const notBlankP = s => s !== '';

const {USERNAME} = process.env;
const WRAP_IN = process.env.WRAP || '0';
const WRAP_P = parseInt(WRAP_IN, 10);

function BasicSource(sourceName) {
	return {
		source: `mapbox://tileset-source/${USERNAME}/${sourceName}`,
		minzoom: 0,
		maxzoom: 22
	};
}

function Recipe(layers) {
	return {
		version: 1,
		layers
	};
}

function Message(recipe) {
	return {
		recipe,
		name: TILESET_NAME
	};
}

const objectify = inFiles => {
	const layers = {};
	inFiles.forEach(file => {
		const name = file.split('.')[0];
		layers[name] = new BasicSource(name);
	});
	return layers;
};

const layers = objectify(SOURCE_IDS_IN);

let output;

if (WRAP_P) {
	output = new Message(new Recipe(layers));
} else {
	output = new Recipe(layers);
}

console.log(
	JSON.stringify(output, null, 2)
);
