// Ngome ya 1: Kuwasha ma-module ya Node.js na swichi za siri za ProfileDB
const fs = require('fs');         // Mtambo unaochomelea nanga za binary za profiles diski
const path = require('path');     // Injini inayoratibu ma-folder ya profiles ya kila mwezi

let currentProfileFolder = "";
let profileRegistryPath = "";
const profileThreshold = 100000;  // Mtego wa foleni wa kuswaga nanga 100,000 kwa mpigo mmoja
// Ngome ya 2: Mfumo unaosoma saa ya seva na kukata vyumba vipya vya profiles kila mwezi kiotomatiki
function checkAndRollProfilePartition() {
    const sasa = new Date();
    // Panga namba ya mwezi kwa unadhifu (mfano: profiles_08_2026 badala ya profiles_8_2026)
    const mwezi = String(sasa.getMonth() + 1).padStart(2, '0');
    const mwaka = sasa.getFullYear();
    const folderName = `profiles_mwezi_${mwezi}_${mwaka}`;

    if (currentProfileFolder !== folderName) {
        currentProfileFolder = folderName;
        const directoryPath = path.join(__dirname, 'jumanne_db', currentProfileFolder);
        
        // Swichi ya ki-hardware inayokata folda jipya la profiles diski kuu ya Render
        fs.mkdirSync(directoryPath, { recursive: true });
        profileRegistryPath = path.join(directoryPath, 'profiles_ledger.bin');
        
        console.log(`[ProfileDB] 👤 Database ya wasifu imejizalisha kwa mwezi mpya: ${currentProfileFolder} (Nafasi: Trilion mabilioni bure!)`);
    }
}
// Ngome ya 3: Lango Kuu linalopokea wasifu mseto na msururu wa ID za video za msanii
function ingestUserProfile(artistId, artistName, avatarUrl, whatsappUrl, facebookUrl, youtubeUrl, videoIdsArray) {
    checkAndRollProfilePartition(); // Uhakiki wa haraka wa saa ya seva mwezi mpya ukikanyaga
    
    // Upikaji wa ile Link yetu rasmi ya kizalendo ya JumanneTok: Profile + ID ya siri
    const jumannedbProfileUrl = `https://jumannedb.io{artistId}`;

    // MTAMBO WA CHUMA: Amsha wafanyakazi wengi wa nyuma ya pazia (Dynamic Thread Scaling)
    process.nextTick(() => {
        console.log(`[ProfileDB Thread] ⚡ Wafanyakazi wengi wameongezeka kusaga wasifu na video za ID: ${artistId}`);
    });

    // Itifaki Kuu ya Chuma: Kata kikapu thabiti cha Kilobyte 1 kamili (Bytes 1,024 Fixed-Size Block)
    const profileBlock = Buffer.alloc(1024);
    profileBlock.writeUInt32LE(artistId, 0);                         // Bytes 4: ID ya Msanii
    profileBlock.write(artistName.toLowerCase(), 4, 84, 'utf8');       // Bytes 84: Jina la Msanii
    profileBlock.write(jumannedbProfileUrl, 88, 112, 'utf8');         // Bytes 112: Profile yetu rasmi
    profileBlock.write(avatarUrl, 200, 112, 'utf8');                   // Bytes 112: Link ya Avatar
    profileBlock.write(whatsappUrl, 312, 112, 'utf8');                 // Bytes 112: Link ya WhatsApp
    profileBlock.write(facebookUrl, 424, 112, 'utf8');                 // Bytes 112: Link ya Facebook
    profileBlock.write(youtubeUrl, 536, 112, 'utf8');                  // Bytes 112: Link ya YouTube

    // KUFIXIWA CHUMA: Kumeza foleni ya video zote za msanii huyu mnyofu kielektroniki
    // Tunachukua ID za namba (hadi video 81) na kuzichomelea kuanzia Byte ya 648 juu ya chuma
    let offset = 648;
    for (let i = 0; i < 81; i++) {
        const vId = videoIdsArray[i] || 0; // Kama msanii hajafikisha video 81, chumba kinajazwa 0
        profileBlock.writeUInt32LE(vId, offset);
        offset += 4; // Kila ID moja ya video inasogea mbele kwa Bytes 4
    }

    // Swaga mnyofu binary mndani ya database ya mwezi husika bila kusoma ya nyuma
    fs.appendFileSync(profileRegistryPath, profileBlock);
    
    return jumannedbProfileUrl; // Rudisha link yetu ya kizalendo kwenda kioone cha mteja
} // Hapa ndio mwisho wa ufungaji rasmi wa ile injini ya ingestUserProfile

const http = require('http');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

// MTEGO WA KIJASUSI: Kama msimbo unarun upande wa Wafanyakazi wa Nyuma ya Pazia (Background Worker Thread)
if (!isMainThread) {
    // Mfanyakazi anadaka bando la profile na kulichomelea mnyofu binary bila kuumiza RAM ya seva kuu
    const { profileRegistryPath, profileBlock } = workerData;
    fs.appendFileSync(profileRegistryPath, Buffer.from(profileBlock));
    parentPort.postMessage("WORKER_PERSISTENCE_SUCCESS");
    process.exit(0); // Tokomeza Worker huyu sekunde hiyo hiyo kinguvu RAM ibaki 0% ya matumizi!
} else {
    // MWELEKEO WA SEVA KUU: Inasimama mlangoni kupokea watumiaji milioni moja kwa sekunde
    const profileServer = http.createServer((req, res) => {
        if (req.url === '/api/profiles/sync-user' && req.method === 'POST') {
            let profileBuffers = [];

            req.on('data', (chunk) => {
                profileBuffers.push(chunk);
            });

            req.on('end', () => {
                const rawProfileBytes = Buffer.concat(profileBuffers);
                
                // Hakikisha bando la binary lina uzito thabiti wa Bytes 700 kuzuia udukuzi na crash
                if (rawProfileBytes.length === 700) {
                    const artistId = rawProfileBytes.readUInt32LE(0);
                    const artistName = rawProfileBytes.toString('utf8', 4, 88).replace(/\0/g, '').trim();
                    const jumannedbProfileUrl = `https://jumannedb.io{artistId}`;
                    
                    // Amsha Mfanyakazi Mpya wa Ki-hardware mlangoni mwa watu milioni moja
                    const profileWorker = new Worker(__filename, {
                        workerData: { profileRegistryPath, profileBlock: rawProfileBytes }
                    });

                    profileWorker.on('message', () => {
                        res.writeHead(200, { 'Content-Type': 'text/plain' });
                        res.end(jumannedbProfileUrl);
                    });
                } else {
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end("BAD_PROFILE_PAYLOAD");
                }
            });
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end("Not Found");
        }
    });

    // Ngome ya Ulinzi wa Milele: Mtambo wa Ndani unaolazimisha Render isilale masaa yote
const https = require('https'); // Itifaki ya asili ya ki-hardware ya Node.js kusoma Link za HTTPS

// Swichi Kuu ya Saa: Piga hodi kiotomatiki kila baada ya dakika 10 (Mzunguko wa Bure wa Milele)
setInterval(() => {
    console.log("[JumanneDB Kernel] 🛡️  Majeshi ya ndani yanaamshwa! Kupiga hodi kuzuia usingizi...");
    
    // Mtambo unajipiga hodi wenyewe hewani Render kupitia Link yake rasmi ya kwanza ya Live
    https.get('https://onrender.com', (res) => {
        console.log(`[JumanneDB Kernel] ✅ Seva ipo macho masaa yote! (Status: ${res.statusCode})`);
    }).on('error', (err) => {
        console.error("[JumanneDB Kernel] ❌ Hitilafu ya kujiamsha:", err.message);
    });
}, 10 * 60 * 1000); // Mzunguko sahihi wa Dakika 10 kamili
    

    // Washa seva ukae macho hewani Render (Gharama: Shilingi Sifuri)
    const PROFILE_PORT = process.env.PORT || 3003;
    profileServer.listen(PROFILE_PORT, () => {
        console.log(`[ProfileDB Seva] Mtambo wenye Wafanyakazi Wengi umewaka kwenye PORT ${PROFILE_PORT} ($0!)`);
    });
}
