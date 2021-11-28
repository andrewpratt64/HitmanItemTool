// Andrew Pratt 2021
// HitmanItemTool (HIT)

const path = require("path");
const fs = require("fs");
const os = require("os");
const process = require("process");
const child_process = require("child_process");
const Ajv2020 = require("ajv/dist/2020");
const ajv = new Ajv2020({
	allErrors: true,
	$data: true
});
require("ajv-errors")(ajv);
//const jsonQuery = require("json-query");


// Returns a given path as a path to a folder
// If a path to a file is given, the path to the folder containing the file is returned
// If a path to a folder is given, the same path is returned
function ensurePathIsFolder(pathVal)
{
	if (path.extname == "")
		return pathVal;
	return path.dirname(pathVal);
}


// Modify and return an ores json object
function processOresJson(ores, cfg)
{
	console.log("Begining modifications to ores");
	// Declare a variable to hold the "all items item", i.e. the item that will give 
	//	the player all items when selected in the loadout
	let allItemsItem = undefined;
	// Declare an array of pairs where the first value of a pair is the
	//	GameAssets string to be inserted into the "all items" item, and
	//	second value is the first value's corresponding RepositoryAssets string
	let allItemsData = [];
	
	// Iterate over every entry in the ores
	for (let [k,v] of Object.entries(ores))
	{
		// Skip any entries that aren't an item
		if (!(v.Type == "gear" || v.Type == "weapon"))
		{
			console.log("Skipping non-item " + v.Id);
			continue;
		}
		//  Skip items that are disabled by the config
		if (!cfg.affectAllItems)
		{
			let bNotFound = true;
			for (let selector of cfg.affect)
			{
				if (
					(selector.type == "*" || v.Type == selector.type)
					&&
					(selector.subtype == "*" || v.Subtype == selector.subtype)
				)
				{
					bNotFound = false;
					break;
				}
			}
			if (bNotFound)
			{
				console.log("Skipping item disabled by config: " + v.Id);
				continue;
			}
		}
		
		// Figure out the value that should be inserted into the GameAssets array
		//	and the value that should be inserted into the RepositoryAssets array
		let gameAssetVal = v.Properties.hasOwnProperty("GameAssets")
			? v.Properties.GameAssets[0]
			: v.Id;
		let repoAssetVal = v.Properties.RepositoryId;
		
		// If the "all items" item is enabled...
		if (cfg.useGetAllItem)
		{
			// ...Store a reference to it if the "all items" item was just now found
			if (v.Id == cfg.getAllItemId)
				allItemsItem = v;
			// If this isn't the "all items" item, append to the allItemsData array
			else
				allItemsData.push(
				{
					first: gameAssetVal,
					second: repoAssetVal
				}
			);
		}
		
		// Ensure the item has both the GameAssets and RepositoryAssets properties,
		//	and that both start out empty
		v.Properties.GameAssets = [];
		v.Properties.RepositoryAssets = [];
		
		// Continuously insert the object into itself based on the config
		for (let i = 0; i < cfg.replaceAmount; i++)
		{
			v.Properties.GameAssets.push(gameAssetVal);
			v.Properties.RepositoryAssets.push(repoAssetVal);
		}
		console.log("Edited item: " + v.Id);
	}
	
	// If the "all items" item is enabled...
	if (cfg.useGetAllItem)
	{
		// ...If the "all items" item was never found, show an error
		if (allItemsItem == undefined)
		{
			console.error("Failed to find item with Id=" + cfg.getAllItemId);
		}
		// Otherwise, continuously insert all items into the "all items" item based on the config
		else
		{
			for (let insertItem of allItemsData)
			{
				for (let i = 0; i < cfg.replaceAllAmount; i++)
				{
					allItemsItem.Properties.GameAssets.push(insertItem.first);
					allItemsItem.Properties.RepositoryAssets.push(insertItem.second);
				}
			}
		}
	}
	
	// Return modified ores
	console.log("Finished modifications to ores");
	return ores;
}


// Run the item tool
function run(pathTmp)
{
	// Instantiate constants
	const LOGGING_ENABLED = true;
	const PATH_CFG = `${__dirname}${path.sep}dat${path.sep}config.json`;
	const PATH_CFG_SCHEMA = `${__dirname}${path.sep}dat${path.sep}config.schema.json`;
	const ORES_HASH = "0057C2C3941115CA";
	
	// Read and parse the config file and it's schema
	console.log("Loading config.json");
	let cfg = JSON.parse(
		fs.readFileSync(PATH_CFG, {encoding: "utf8"})
	);
	console.log("Loading config.schema.json");
	let cfgSchema = ajv.compile(
		JSON.parse(
			fs.readFileSync(PATH_CFG_SCHEMA, {encoding: "utf8"})
		)
	);
	
	// Show an error message and bail if validation failed
	if (cfgSchema(cfg))
		console.log("Config is valid");
	else
	{
		console.error("Config is invalid");
		for (let err of cfgSchema.errors)
		{
			if (err.instancePath == "/ready" && err.keyword == "const")
				console.error("You need to setup config.json before running! Set the \"ready\" property to true when you have");
			else
				console.error(`Error type "${err.keyword}" at property ${err.instancePath == "" ? "<ROOT>" : '\"' + err.instancePath + '\"'} ${err.message}`);
		}
		return;
	}
	
	// Find the latest patch for chunk 0
	/*console.log("Searching for the latest patch of chunk 0");
	const runtimeFiles = fs.readdirSync(cfg.pathHitmanRuntime);
	let latestPatch = -1;
	for (const file of runtimeFiles)
	{
		if (file.length > 16 && file.startsWith("chunk0patch") && file.endsWith(".rpkg"))
		{
			let patchStr = file.slice(11, -5);
			if (/\d+/.test(patchStr))
			{
				patchVal = parseInt(patchStr);
				if (patchVal > latestPatch)
					latestPatch = patchVal;
			}
		}
	}
	// Bail if no patch was found
	if (latestPatch < 0)
	{
		console.error("Failed to find latest patch for chunk 0");
		return;
	}*/ 
	let latestPatch = cfg.inputPatch; // <- Temporary
	let rpkgName = "chunk0patch" + latestPatch;
	let pathRpkg = path.join(cfg.pathHitmanRuntime, rpkgName + ".rpkg");
	console.log(`Latest patch found: Patch #${latestPatch} at "${pathRpkg}"`);
	
	
	// Extract the ores file from Hitman 3
	console.log(`Extracting ${ORES_HASH}.ORES`);
	let pathOres = path.join(pathTmp, rpkgName, "ORES", ORES_HASH + ".ORES");
	child_process.execSync(`"${cfg.pathRpkgCli}" -filter ${ORES_HASH} -extract_from_rpkg "${pathRpkg}" -output_path "${pathTmp}"`);
	
	// Convert the ores to json
	console.log("Converting ores to json");
	child_process.execSync(`${cfg.pathOresTool} ${pathOres}`);
	
	console.log("Modifying " + pathOres + ".json");
	// Save the modified ores json file
	fs.writeFileSync(
		pathOres + ".json",
		// Stringify the modified ores json
		JSON.stringify(
			// Modify the ores json
			processOresJson(
				// Parse the unmodified ores json
				JSON.parse(
					// Load the unmodified ores json file
					fs.readFileSync(pathOres + ".json", {encoding: "utf8"})
				),
				cfg
			)
		),
		{encoding: "utf8"}
	);
	
	// Delete the unmodified ores, just in case
	console.log("Deleting old ores");
	fs.unlinkSync(pathOres);
	
	// Convert the ores json back to ores
	console.log("Converting json back to ores");
	child_process.execSync(`${cfg.pathOresTool} ${pathOres + ".json"}`);
	
	// Delete the ores json
	console.log("Deleting ores json");
	fs.unlinkSync(pathOres + ".json");
	
	// Rename the folder containing the ores file to the name of the chunk to generate
	let pathOutChunkSrc = path.join(pathTmp, rpkgName, "chunk0patch" + cfg.outputPatch);
	console.log("Renaming ores parent folder to: " + pathOutChunkSrc);
	fs.renameSync(path.join(pathTmp, rpkgName, "ORES"), pathOutChunkSrc);
	
	// Generate an rpkg file from the renamed folder
	console.log("Generating rpkg");
	child_process.execSync(`"${cfg.pathRpkgCli}" -generate_rpkg_from "${pathOutChunkSrc}" -output_path "${cfg.pathHitmanRuntime}"`);
}


// Script entry point
function main()
{
	// Show title
	console.info("HitmanItemTool by Andrew Pratt");
	
	// Create a temporary directory to work with
	console.log("Attempting to create a temporary directory");
	pathTmp = fs.mkdtempSync(path.join(os.tmpdir(), "HitmanItemTool"));
	console.log("Temporary directory created at " + pathTmp);
	
	// Run HIT
	let caughtErr = undefined;
	try
	{
		run(pathTmp);
		console.log("Finished generating rpkg file without any errors");
	}
	catch (err)
	{
		// If an error occured, store it before ending the program to make sure
		//	the temporary directory is deleted
		console.error("An error was caught, it will be thrown after the temporary directory is deleted");
		caughtErr = err;
	}
	
	// Delete the temporary directory
	console.log("Attempting to delete temporary directory at " + pathTmp);
	fs.rmdirSync(pathTmp, {recursive: true});
	console.log("Temporary path deleted");
		
	
	// Re-throw a previously caught error, if one exists
	if (caughtErr != undefined)
	{
		console.log("Re-throwing previously caught error");
		throw caughtErr;
	}
	
	console.log("Done");
}
main();