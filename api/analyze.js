// api/analyze.js
export default async function handler(req, res) {
    // 1. Validate Request
    const { address } = req.query;
    if (!address || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) {
        return res.status(400).json({ error: 'Invalid TRON address format.' });
    }

    // 2. Fetch Contract Data from Tronscan
    // Use your API Key (set in Vercel Environment Variables as TRONSCAN_API_KEY)
    const apiKey = process.env.TRONSCAN_API_KEY;
    const url = `https://apilist.tronscanapi.com/api/contract?contract=${address}`;

    try {
        const response = await fetch(url, {
            headers: apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {}
        });

        if (!response.ok) {
            if (response.status === 401) throw new Error('Tronscan API Key missing or invalid.');
            if (response.status === 429) throw new Error('Rate limit exceeded. Please try again later.');
            throw new Error(`Tronscan API Error: ${response.status}`);
        }

        const data = await response.json();
        const contract = data.data?.[0];

        if (!contract) throw new Error('Contract not found.');
        if (!contract.code) throw new Error('Source code is not verified.');

        // 3. Analyze the Source Code
        const analysis = analyzeContract(contract.code, contract.abi);

        // 4. Return Results
        return res.status(200).json({
            address,
            name: contract.name || 'Unknown Contract',
            ...analysis
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

// ─── Analysis Engine ───────────────────────────────────────────
function analyzeContract(sourceCode, abiString) {
    const OWNERSHIP_MODIFIERS = [
        'onlyOwner', 'onlyAdmin', 'onlyRole', 'onlyMinter', 'onlyOperator',
        'onlyGovernance', 'onlyDAO', 'auth', 'restricted', 'onlyAuthorized'
    ];

    const CRITICAL_FUNCTIONS = [
        'withdraw', 'withdrawAll', 'withdrawToken', 'withdrawERC20', 'withdrawTRX',
        'transferFrom', 'transfer', 'transferOwnership', 'renounceOwnership',
        'mint', 'burn', 'burnFrom', 'pause', 'unpause', 'setFee', 'setTax',
        'setMaxTx', 'setMaxWallet', 'blacklist', 'setBlacklist', 'upgradeTo',
        'setImplementation', 'execute', 'sweep', 'rescueToken', 'rescueTRX'
    ];

    let abi;
    try {
        abi = JSON.parse(abiString || '[]');
    } catch {
        abi = [];
    }

    const functions = abi.filter(item => item.type === 'function');
    const findings = [];

    for (const fn of functions) {
        const fnName = fn.name;
        if (!fnName || fn.stateMutability === 'view' || fn.stateMutability === 'pure') continue;

        const isCritical = CRITICAL_FUNCTIONS.some(c => fnName.toLowerCase().includes(c.toLowerCase()));
        const hasModifier = checkFunctionHasModifier(sourceCode, fnName);

        if (!hasModifier) {
            if (isCritical) {
                findings.push({
                    function: fnName,
                    severity: 'HIGH',
                    reason: `Critical function '${fnName}' is public and lacks an ownership modifier (e.g., onlyOwner). Anyone can call it.`
                });
            } else {
                findings.push({
                    function: fnName,
                    severity: 'MEDIUM',
                    reason: `Public function '${fnName}' has no ownership modifier. Ensure this is intended.`
                });
            }
        }
    }

    const hasHigh = findings.some(f => f.severity === 'HIGH');
    const riskLevel = hasHigh ? 'HIGH RISK / DRAINABLE' : (findings.length > 0 ? 'WARNING' : 'SAFE');

    return { riskLevel, findings };
}

function checkFunctionHasModifier(source, fnName) {
    // Find the function signature block
    const regex = new RegExp(`function\\s+${escapeRegExp(fnName)}\\s*\\([^)]*\\)[^{]*\\{`, 's');
    const match = source.match(regex);
    if (!match) return false; // Cannot verify, assume unsafe

    const signatureBlock = match[0].toLowerCase();

    // Check for known ownership modifiers
    for (const mod of OWNERSHIP_MODIFIERS) {
        if (signatureBlock.includes(mod.toLowerCase())) return true;
    }

    // Check for inline require statements (e.g., require(msg.sender == owner))
    if (signatureBlock.includes('msg.sender') && 
       (signatureBlock.includes('owner') || signatureBlock.includes('admin'))) {
        return true;
    }

    return false;
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
