import axios from 'axios';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

// Define storage path (Railway Volume or Local)
const TOKEN_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH 
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'tokens.json') 
    : './tokens.json';

export async function getAccessToken() {
    // 1. If tokens file exists, use it
    if (fs.existsSync(TOKEN_PATH)) {
        const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
        const now = Date.now();
        
        // If token is valid (with 5 min buffer), return it
        if (tokens.expires_at > now + 300000) {
            return tokens.access_token;
        }
        // If expired, refresh it
        return await refreshToken(tokens.refresh_token);
    } 
    
    // 2. If NO file exists, we need to initialize
    console.log("⚠️ No tokens.json found. Initialization started...");

    // Check if we have the "def50..." code in the ENV to do the first exchange
    const envToken = process.env.KOMMO_REFRESH_TOKEN || "";
    
    if (envToken.startsWith('def50')) {
        console.log("🚀 Authorization Code detected! exchanging for permanent keys...");
        return await exchangeAuthCode(envToken);
    } else {
        // Fallback: Use the Access Token from Env temporarily (Manual Mode)
        console.log("⚠️ Using Long-Lived Access Token from .env");
        return process.env.KOMMO_ACCESS_TOKEN;
    }
}

// 🔵 FUNCTION 1: Initial Exchange (Run Once)
async function exchangeAuthCode(authCode) {
    try {
        const res = await axios.post(`https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/oauth2/access_token`, {
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: authCode,
            redirect_uri: process.env.REDIRECT_URI
        });

        return saveTokens(res.data);
    } catch (err) {
        console.error('❌ Error exchanging Authorization Code:', err.response?.data || err.message);
        throw new Error("Authorization Code Expired or Invalid. Please generate a new one in Kommo.");
    }
}

// 🔵 FUNCTION 2: Regular Refresh (Runs automatically forever)
async function refreshToken(currentRefreshToken) {
    try {
        console.log("🔄 Refreshing Kommo Token...");
        const res = await axios.post(`https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/oauth2/access_token`, {
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: currentRefreshToken,
            redirect_uri: process.env.REDIRECT_URI
        });

        console.log("✅ Token Refreshed Successfully");
        return saveTokens(res.data);
    } catch (err) {
        console.error('❌ Critical Error Refreshing Token:', err.response?.data || err.message);
        throw err;
    }
}

// Helper to save to disk
function saveTokens(data) {
    const newTokens = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + (data.expires_in * 1000)
    };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(newTokens, null, 2));
    return newTokens.access_token;
}