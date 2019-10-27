#!/bin/bash

runMapboxing() {
	mkdir $2
	PGUSER=$PGUSER \
	PGHOST=$PGHOST \
	PGPASSWORD=$PGPASSWORD \
	PGDATABASE=$PGDATABASE \
	node $1 $2
	echo meme
}

uploadSource() {
	filePath=$1
	sourceName=$2
	curl -X POST "https://api.mapbox.com/tilesets/v1/sources/aljedaxi/$sourceName?access_token=$TOKEN" \
		 -F file=@$filePath \
		 --header "Content-Type: multipart/form-data"
}

checkSource() {
	sourceName=$1
	curl "https://api.mapbox.com/tilesets/v1/sources/aljedaxi/$sourceName?access_token=$TOKEN"
}

createSources() {
	inFilesDir=$1
	inFiles=`ls $inFilesDir`
	sourceIDs=$2
	for file in $inFiles
	do
		IFS='.' read -ra file_name <<< "$file"
		sourceName="$file_name"
		filePath="$inFilesDir/$file"
		if [ $TESTING = 0 ]
		then
			uploadSource $filePath $sourceName
			checkSource $sourceName
		fi
		sourceIDs="$sourceIDs $sourceName"
	done
}

validateRecipe() {
	curl -X PUT "https://api.mapbox.com/tilesets/v1/validateRecipe?access_token=$TOKEN" \
	  -d @$1 \
	  --header "Content-Type:application/json"
}

createRecipe() {
	recipe_filename=$2
	sources=$3
	recipingCommand=$1
	USERNAME=$USERNAME WRAP=1 node make-recipe.js $TILESET_NAME "$sources" #> $recipe_filename
	#validateRecipe $RECIPE_FILENAME
}

createTileset() {
	tileset_filename=$1
	recipe_filename=$2
	curl -X POST "https://api.mapbox.com/tilesets/v1/$tileset_filename?access_token=$TOKEN" \
	  -d @$recipe_filename \
	  --header "Content-Type:application/json" 
}

publishTileset() {
	id=$1
	curl -X POST "https://api.mapbox.com/tilesets/v1/$id/publish?access_token=$TOKEN"
}

sourceIDs=''
outputDir='./geojson-ld'
runMapboxing mapboxing.js $outputDir
#createSources make-recipe.js $outputDir $sourceIDs
#createRecipe $RECIPE_FILENAME "$sourceIDs"
#createTileset $TILESET_ID $RECIPE_FILENAME
#publishTileset $TILESET_ID
