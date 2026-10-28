import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceFile = path.join(here, "src", "StudioBeacon.server.lua");
const outDir = path.join(here, "dist");
const outFile = path.join(outDir, "StudioBeacon.rbxmx");

const source = await readFile(sourceFile, "utf8");

if (source.includes("]]>")) {
  throw new Error("The plugin source cannot contain the CDATA terminator ]]>");
}

for (const placeholder of ["__STUDIO_BEACON_TOKEN__", "__STUDIO_BEACON_URL__"]) {
  if (!source.includes(placeholder)) {
    throw new Error(`The plugin source is missing the ${placeholder} placeholder`);
  }
}

const xml = `<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">
	<Item class="Script" referent="RBX0">
		<Properties>
			<string name="Name">StudioBeacon</string>
			<ProtectedString name="Source"><![CDATA[${source}]]></ProtectedString>
			<bool name="Disabled">false</bool>
		</Properties>
	</Item>
</roblox>
`;

await mkdir(outDir, { recursive: true });
await writeFile(outFile, xml, "utf8");

const bytes = Buffer.byteLength(xml);
console.log(`plugin written: ${path.relative(process.cwd(), outFile)} (${bytes} bytes)`);
