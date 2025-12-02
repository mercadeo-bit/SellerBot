import axios from 'axios';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

// Use Railway storage if available
const TOKEN_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH 
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'tokens.json') 
    : './tokens.json';

export async function getAccessToken() {
    // 1. Check if tokens file exists
    if (fs.existsSync(TOKEN_PATH)) {
        const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
        const now = Date.now();
        // Return if valid (5 min buffer)
        if (tokens.expires_at > now + 300000) {
            return tokens.access_token;
        }
        return await refreshToken(tokens.refresh_token);
    } 
    
    console.log("⚠️ No tokens.json found. Checking ENV for initial connection...");

    // 2. Initial Setup check
    // We check KOMMO_REFRESH_TOKEN for the 'def50' code or an existing refresh token
    const envToken = process.env.KOMMO_REFRESH_TOKEN || "";
    
    if (envToken.startsWith('def50')) {
        console.log("🚀 Authorization Code (def50) detected! Exchanging for permanent keys...");
        return await exchangeAuthCode(envToken);
    } else {
        console.log("⚠️ Using manual Access Token from ENV.");
        return process.env.KOMMO_ACCESS_TOKEN;
    }
}

async function exchangeAuthCode(authCode) {
    try {
        const res = await axios.post(`https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/oauth2/access_token`, {
            client_id: process.env.KOMMO_CLIENT_ID,        // UPDATED NAME
            client_secret: process.env.KOMMO_CLIENT_SECRET, // UPDATED NAME
            grant_type: 'authorization_code',
            code: authCode,
            redirect_uri: process.env.KOMMO_REDIRECT_URI    // UPDATED NAME
        });
        return saveTokens(res.data);
    } catch (err) {
        console.error('❌ Auth Code Error:', err.response?.data || err.message);
        throw new Error("Auth Code Invalid/Expired. Please generate a new code in Kommo.");
    }
}

async function refreshToken(currentRefreshToken) {
    try {
        console.log("🔄 Refreshing Kommo Token...");
        const res = await axios.post(`https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/oauth2/access_token`, {
            client_id: process.env.KOMMO_CLIENT_ID,        // UPDATED NAME
            client_secret: process.env.KOMMO_CLIENT_SECRET, // UPDATED NAME
            grant_type: 'refresh_token',
            refresh_token: currentRefreshToken,
            redirect_uri: process.env.KOMMO_REDIRECT_URI    // UPDATED NAME
        });
        return saveTokens(res.data);
    } catch (err) {
        console.error('❌ Token Refresh Error:', err.response?.data || err.message);
        throw err;
    }
}

function saveTokens(data) {
    const newTokens = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + (data.expires_in * 1000)
    };
    // Ensure directory exists if using volume
    if (process.env.RAILWAY_VOLUME_MOUNT_PATH && !fs.existsSync(process.env.RAILWAY_VOLUME_MOUNT_PATH)){
        fs.mkdirSync(process.env.RAILWAY_VOLUME_MOUNT_PATH, { recursive: true });
    }
    
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(newTokens, null, 2));
    console.log("✅ Tokens saved to disk.");
    return newTokens.access_token;
}