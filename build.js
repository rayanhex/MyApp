// FlipFinder Build Script
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

console.log('🔧 Building FlipFinder extension...');

// Check if .env file exists
if (!fs.existsSync('.env')) {
  console.error('❌ Error: .env file not found');
  console.error('📝 Please create a .env file based on .env.example');
  console.error('   Copy: cp .env.example .env');
  console.error('   Then add your actual API keys to .env');
  process.exit(1);
}

// Check if environment variables exist
if (!process.env.GROK_API_KEY || !process.env.EBAY_API_KEY) {
  console.error('❌ Error: API keys not found in .env file');
  console.error('📝 Please add your API keys to the .env file:');
  console.error('   GROK_API_KEY=your_actual_grok_key');
  console.error('   EBAY_API_KEY=your_actual_ebay_token');
  process.exit(1);
}

// Validate API keys (basic format check)
if (process.env.GROK_API_KEY.length < 10) {
  console.error('❌ Error: Grok API key seems too short');
  process.exit(1);
}

if (process.env.EBAY_API_KEY.length < 20) {
  console.error('❌ Error: eBay API key seems too short');
  process.exit(1);
}

try {
  // Check if template exists
  if (!fs.existsSync('background.template.js')) {
    console.error('❌ Error: background.template.js not found');
    console.error('📝 Please ensure background.template.js exists in the project root');
    process.exit(1);
  }

  // Read template
  console.log('📖 Reading background.template.js...');
  const template = fs.readFileSync('background.template.js', 'utf8');

  // Replace placeholders with environment variables
  console.log('🔄 Injecting API keys...');
  const final = template
    .replace(/\{\{GROK_API_KEY\}\}/g, process.env.GROK_API_KEY)
    .replace(/\{\{EBAY_API_KEY\}\}/g, process.env.EBAY_API_KEY);

  // Verify replacements worked
  if (final.includes('{{GROK_API_KEY}}') || final.includes('{{EBAY_API_KEY}}')) {
    console.error('❌ Error: API key replacement failed');
    process.exit(1);
  }

  // Write final file (this file is in .gitignore)
  console.log('💾 Writing background.js...');
  fs.writeFileSync('background.js', final);
  
  // Success message
  console.log('✅ Build completed successfully!');
  console.log('🔒 API keys injected securely');
  console.log('📁 background.js ready for Chrome extension');
  console.log('');
  console.log('🚀 Next steps:');
  console.log('   1. Load extension in Chrome (chrome://extensions/)');
  console.log('   2. Enable Developer mode');
  console.log('   3. Click "Load unpacked" and select this folder');
  console.log('');
  console.log('⚠️  Remember: background.js contains your API keys and should never be committed to Git');
  
} catch (error) {
  console.error('❌ Build failed:', error.message);
  console.error('🔍 Error details:', error);
  process.exit(1);
}