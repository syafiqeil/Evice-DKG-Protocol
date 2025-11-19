// backend/publish-assets.js
require('dotenv').config();
const DKG = require('dkg.js');

// Konfigurasi DKG Client (Gunakan Testnet Node)
const dkgOptions = {
    endpoint: process.env.OT_NODE_ENDPOINT || 'http://localhost:8900', 
    port: 8900,
    useSSL: false,
    loglevel: 'info',
    blockchain: {
        name: 'otp:2043', // NeuroWeb Testnet
        publicKey: process.env.EVM_PUBLIC_KEY,
        privateKey: process.env.EVM_PRIVATE_KEY, 
    },
    maxNumberOfRetries: 30,
    frequency: 2,
    contentType: 'all',
};

const dkg = new DKG(dkgOptions);

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
        
        console.log(`✅ ${type} Published!`);
        console.log(`🔗 UAL: ${result.UAL}`);
        return result.UAL;
    } catch (error) {
        console.error(`❌ Gagal publish ${type}:`, error);
    }
}

(async () => {
    // Data yang akan di-upload
    const tokenomicsText = "Tokenomics: 50% Community, 30% Team, 20% Foundation. Vesting 4 years.";
    const roadmapText = "Roadmap: Q1 DKG Integration, Q2 Mainnet Launch, Q3 AI Agents Swarm.";

    const ual1 = await publishData("Tokenomics", tokenomicsText);
    const ual2 = await publishData("Roadmap", roadmapText);

    console.log("\n🎉 SIMPAN KODE UAL INI UNTUK SERVER.JS:");
    console.log(`TOKENOMICS_UAL="${ual1}"`);
    console.log(`ROADMAP_UAL="${ual2}"`);
})();