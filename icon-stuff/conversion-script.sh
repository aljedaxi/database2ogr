mkdir new_files
echo "this doesn't work for the decisions point icon"
for file in $(ls svg_files/)
do
	file_name=$(echo "$file" | cut -f 1 -d '.')
	size=$(echo "$file_name" | cut -f 2 -d '-')
	inkscape -z -e new_files/$file_name.png -w 1024 -h 1024 svg_files/$file_name.svg
	convert new_files/$file_name.png -channel RGB -negate files-$size/new-$file_name.png
	echo $file_name
done
