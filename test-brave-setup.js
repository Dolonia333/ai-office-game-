#!/usr/bin/env node

/**
 * Quick test script to verify Brave Search API key setup in OpenClaw
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const BRAVE_API_KEY = 'BSAgPTfHr7FVrJGJj37uJMQcIgP0aB_';

async function testBraveSearchSetup() {
  console.log('🔍 OpenClaw Brave Search Setup Test\n');

  // Test 1: Environment variable
  const envKey = process.env.BRAVE_API_KEY;
  console.log('1. Environment Variable Check:');
  console.log(`   BRAVE_API_KEY: ${envKey ? '✅ Set' : '❌ Missing'}`);
  if (envKey && envKey !== BRAVE_API_KEY) {
    console.log(`   ⚠️  Value mismatch! Expected: BSAgPT..., Got: ${envKey.slice(0, 10)}...`);
  }
  console.log('');

  // Test 2: Config file
  try {
    const configPath = join(homedir(), '.openclaw', 'config.json');
    const configContent = readFileSync(configPath, 'utf8');
    const config = JSON.parse(configContent);
    
    console.log('2. Config File Check:');
    const searchConfig = config.tools?.web?.search;
    if (searchConfig) {
      console.log(`   tools.web.search.enabled: ${searchConfig.enabled !== false ? '✅ True' : '❌ False'}`);
      console.log(`   tools.web.search.provider: ${searchConfig.provider || 'brave'}`);
      console.log(`   tools.web.search.apiKey: ${searchConfig.apiKey ? '✅ Set' : '❌ Missing'}`);
    } else {
      console.log('   ❌ No search config found');
    }
  } catch (error) {
    console.log('2. Config File Check:');
    console.log(`   ❌ Could not read config: ${error.message}`);
  }
  console.log('');

  // Test 3: Direct API call
  console.log('3. Direct API Test:');
  try {
    const testUrl = new URL('https://api.search.brave.com/res/v1/web/search');
    testUrl.searchParams.set('q', 'test');
    testUrl.searchParams.set('count', '1');

    const response = await fetch(testUrl.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': BRAVE_API_KEY,
      },
    });

    console.log(`   HTTP Status: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      const data = await response.json();
      const resultCount = data.web?.results?.length || 0;
      console.log(`   ✅ API Working! Got ${resultCount} results`);
    } else {
      const errorText = await response.text();
      console.log(`   ❌ API Error: ${errorText}`);
    }
  } catch (error) {
    console.log(`   ❌ Network Error: ${error.message}`);
  }
  console.log('');

  // Test 4: Recommendations
  console.log('4. Recommendations:');
  const hasEnvKey = Boolean(process.env.BRAVE_API_KEY);
  
  if (!hasEnvKey) {
    console.log('   🔧 Set environment variable:');
    console.log(`   setx BRAVE_API_KEY "${BRAVE_API_KEY}"`);
    console.log('');
    console.log('   🔄 Then restart OpenClaw gateway');
  } else {
    console.log('   ✅ Environment looks good!');
    console.log('   🔄 Make sure to restart gateway after setting env vars');
  }
}

testBraveSearchSetup().catch(console.error);