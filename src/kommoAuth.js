import axios from 'axios';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();


const tokenFile = './tokens.json';


export async function getAccessToken() {
let tokens = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
const now = Date.now();
if (now < tokens.expires_at) return tokens.access_token;
return refreshToken(tokens.refresh_token);
}


async function refreshToken(refresh_token) {
try {
const res = await axios.post(`https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/oauth2/access_token`, {
client_id: process.env.CLIENT_ID,
client_secret: process.env.CLIENT_SECRET,
grant_type: 'refresh_token',
refresh_token,
redirect_uri: process.env.REDIRECT_URI
});


const newTokens = {
access_token: res.data.access_token,
refresh_token: res.data.refresh_token,
expires_at: Date.now() + res.data.expires_in * 1000 - 60000
};
fs.writeFileSync(tokenFile, JSON.stringify(newTokens));
return newTokens.access_token;
} catch (err) {
console.error('Error al renovar token:', err.response?.data || err);
throw err;
}
}