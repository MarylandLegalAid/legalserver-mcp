/**
 * Unified API client for LegalServer integration.
 * Handles Google Secret Manager authentication, Bearer token caching, and request retry logic.
 * Includes automatic data optimization to strip null/empty values for LLM efficiency.
 * * Dependencies: Requires LEGALSERVER_BASE_URL, PROJECT_ID, and API_SECRET_NAME environment variables.
 * Secret Requirement: The name of the secret in Google Secret Manager is configured via the API_SECRET_NAME environment variable.
 */

const { GoogleAuth } = require('google-auth-library');

const LEGALSERVER_BASE_URL = process.env.LEGALSERVER_BASE_URL;
const PROJECT_ID = process.env.PROJECT_ID;
const API_SECRET_NAME = process.env.API_SECRET_NAME;

if (!LEGALSERVER_BASE_URL || !PROJECT_ID || !API_SECRET_NAME) {
  console.error('CRITICAL ERROR: One or more required environment variables are missing: LEGALSERVER_BASE_URL, PROJECT_ID, API_SECRET_NAME.');
  process.exit(1);
}

/**
 * Strips Null, Empty, N/A, and "No Answer" values to optimize token usage.
 */
function optimizeForVertex(data) {
    if (Array.isArray(data)) {
        return data
            .map(item => optimizeForVertex(item))
            .filter(item => item !== null && (typeof item !== 'object' || Object.keys(item).length > 0));
    }
    if (typeof data !== 'object' || data === null) return data;

    const optimized = {};
    Object.keys(data).forEach(key => {
        const val = data[key];
        const isInvalid = (
            val === undefined || val === null || val === '' || 
            val === "No Answer" || val === "N/A" || val === "null" ||
            (Array.isArray(val) && val.length === 0)
        );
        if (!isInvalid) {
            optimized[key] = typeof val === 'object' ? optimizeForVertex(val) : val;
        }
    });
    return optimized;
}

let bearerTokenCache = null;

async function getBearerToken() {
  if (bearerTokenCache) {
    return bearerTokenCache;
  }

  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });
  const client = await auth.getClient();
  const accessToken = (await client.getAccessToken()).token;

  const url = `https://secretmanager.googleapis.com/v1/projects/${PROJECT_ID}/secrets/${API_SECRET_NAME}/versions/latest:access`;
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    throw new Error(`Secret Manager error: ${response.status} ${await response.text()}`);
  }

  const secretPayload = await response.json();
  const encoded = secretPayload.payload.data;
  const token = Buffer.from(encoded, 'base64').toString('utf-8').replace(/\s/g, '');
  bearerTokenCache = token;
  return token;
}

/**
 * Consolidated API Caller with retry logic and data optimization.
 */
async function callLegalserverAPI(endpoint, queryParams = {}, returnBinary = false, retryCount = 0) {
  if (retryCount > 3) {
      console.error('Critical Error: Authentication failed 3 times for [ENDPOINT].');
      throw new Error("Authentication failed after multiple retries. Please contact IT Support."); 
  }

  const token = await getBearerToken();

  const url = new URL(endpoint, LEGALSERVER_BASE_URL); 
  Object.keys(queryParams).forEach(key => url.searchParams.append(key, queryParams[key])); 

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': returnBinary ? '*/*' : 'application/json',
    },
  }); 

  if ((response.status === 401 || response.status === 403) && retryCount < 1) {
    bearerTokenCache = null; 
    console.warn(`Status ${response.status} on [ENDPOINT]. Attempting fresh session retry (Attempt ${retryCount + 1})...`);
    return callLegalserverAPI(endpoint, queryParams, returnBinary, retryCount + 1);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`LegalServer API error: ${response.status} on ${endpoint}. Details: ${errorBody}`);
  }

  if (returnBinary) {
    const MAX_SIZE = 31457288;
    const contentLengthHeader = response.headers.get('content-length');

    if (contentLengthHeader) {
      const contentLength = parseInt(contentLengthHeader, 10);
      if (contentLength > MAX_SIZE) {
        const sizeInMB = (contentLength / (1024 * 1024)).toFixed(2);
        throw new Error(`File is too large (${sizeInMB}MB). System limit is 30MB to prevent crashes.`);
      }
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (!contentLengthHeader && buffer.length > MAX_SIZE) {
      const sizeInMB = (buffer.length / (1024 * 1024)).toFixed(2);
      throw new Error(`File is too large (${sizeInMB}MB). System limit is 30MB to prevent crashes.`);
    }

    return {
      content: buffer,
      mimeType: response.headers.get('content-type'),
      contentDisposition: response.headers.get('content-disposition')
    };
  }

  const rawJson = await response.json();
  return optimizeForVertex(rawJson);
}

module.exports = { callLegalserverAPI, optimizeForVertex };
