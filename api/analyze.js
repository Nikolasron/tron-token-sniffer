// api/analyze.js
export default async function handler(req, res) {
    const { address, mode } = req.query;

    const apiKey = process.env.TRONSCAN_API_KEY;
    const headers = apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {};

    try {
        // ─── MODE 1: AUTO-SCAN LATEST CONTRACTS ───
        if (mode === 'latest') {
            // Fetch the 5 most recently verified contracts from Tronscan
            const listRes = await fetch('https://apilist.tronscanapi.com/api/contracts?verified-only=true&limit=5&start=0&sort=-timestamp', { headers });
            const listData = await listRes.json();
            
            if (!listData.data) throw new Error("Could not fetch contract list.");
            
            const results = [];
            for (const item of listData.data) {
                // Fetch detailed source code for each
                const detailRes = await fetch(`https://apilist.tronscanapi.com/api/contract?contract=${item.address}`, { headers });
                const detailData = await detailRes.json();
                const contract = detailData.data?.[0];
                
                if (contract && contract.code) {
                    const analysis = analyzeContract(contract.code, contract.abi);
                    results.push({ address: item.address, name: item.name || 'Unknown', ...analysis });
                }
            }
            return res.status(200).json({ results });
        }

        // ─── MODE 2: SCAN SINGLE ADDRESS ───
        if (!address || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) {
            return res.status(400).json({ error: 'Invalid TRON address format.' });
        }

        const response = await fetch(`https://apilist.tronscanapi.com/api/contract?contract=${address}`, { headers });
        if (!response.ok) throw new Error(`Tronscan API Error: ${response.status}`);

        const data = await response.json();
        const contract = data.data?.[0];

        if (!contract) throw new Error('Contract not found.');
        if (!contract.code) throw new Error('Source code is not verified.');

        const analysis = analyzeContract(contract.code, contract.abi);
        return res.status(200).json({ address, name: contract.name || 'Unknown Contract', ...analysis });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

// [Keep the analyzeContract, checkFunctionHasModifier, and escapeRegExp functions exactly as they are in your current file]
