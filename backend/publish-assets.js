// backend/publish-assets.js
require('dotenv').config();
const DKG = require('dkg.js');

// Konfigurasi DKG Client (Gunakan Testnet Node)
const dkgOptions = {
    endpoint: process.env.OT_NODE_ENDPOINT || 'http://localhost',
    port: process.env.OT_NODE_PORT || 8900,
    useSSL: true,
    loglevel: 'info',
    blockchain: {
        name: 'otp:20430', // NeuroWeb Testnet
        publicKey: process.env.EVM_PUBLIC_KEY,
        privateKey: process.env.EVM_PRIVATE_KEY, 
    },
    maxNumberOfRetries: 30,
    frequency: 2,
    contentType: 'all',
};

const dkg = new DKG(dkgOptions);

// Fungsi Helper untuk Jeda (Sleep)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function publishData(type, contentData) {
    console.log(`🚀 Publishing ${type} to DKG...`);
    
    const asset = {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": `Evice Protocol: ${type}`,
        "text": contentData,
        "author": {
            "@type": "Organization",
            "name": "Evice Labs"
        },
        "datePublished": new Date().toISOString()
    };

    try {
        // Create Asset di DKG
        const result = await dkg.asset.create(
            {
                public: asset // Data publik
            },
            {
                keywords: ['Evice', 'x402', type, 'Hackathon'],
                epochsNum: 5 // Simpan selama 5 epoch
            }
        );
        
        // DEBUG LOG: Lihat apa isi result sebenarnya
        console.log(`🔍 Debug Result for ${type}:`, JSON.stringify(result, null, 2));

        if (result.UAL) {
            console.log(`✅ ${type} Published!`);
            console.log(`🔗 UAL: ${result.UAL}`);
            return result.UAL;
        } else {
            console.error(`⚠️ ${type} Published but UAL is missing!`);
            return null;
        }
        
    } catch (error) {
        console.error(`❌ Gagal publish ${type}:`, error);
        return null;
    }
}

(async () => {
    // Data yang akan di-upload
    const tokenomicsText = "Tokenomics: 50% Community, 30% Team, 20% Foundation. Vesting 4 years.";
    const roadmapText = "Roadmap: Q1 DKG Integration, Q2 Mainnet Launch, Q3 AI Agents Swarm.";

    // Publish Tokenomics
    const ual1 = await publishData("Tokenomics", tokenomicsText);
    
    // JEDA 10 DETIK untuk mencegah nonce error / node overload
    console.log("⏳ Menunggu 10 detik sebelum publish berikutnya...");
    await sleep(10000);

    // Publish Roadmap
    const ual2 = await publishData("Roadmap", roadmapText);

    console.log("\n🎉 SIMPAN KODE UAL INI UNTUK SERVER.JS:");
    console.log(`TOKENOMICS_UAL="${ual1}"`);
    console.log(`ROADMAP_UAL="${ual2}"`);
})();