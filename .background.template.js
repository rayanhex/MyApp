// FlipFinder Background Service Worker Template

// API Configuration - Will be injected by build script
const GROK_API_KEY = '{{GROK_API_KEY}}';
const EBAY_API_KEY = '{{EBAY_API_KEY}}';

// Rate limiting protection
let lastEbayCall = 0;
const EBAY_RATE_LIMIT_MS = 2000; // 2 seconds between calls

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'takeScreenshot':
      takeScreenshot(sendResponse);
      return true; // Keep message channel open for async response
      
    case 'analyzeWithGrok':
      analyzeWithGrok(request.text, sendResponse);
      return true;
      
    case 'searchEbay':
      searchEbaySoldListings(request.title, sendResponse);
      return true;
      
    default:
      sendResponse({ error: 'Unknown action' });
  }
});

async function takeScreenshot(sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'png',
      quality: 100
    }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ screenshot: dataUrl });
      }
    });
  } catch (error) {
    sendResponse({ error: error.message });
  }
}

async function analyzeWithGrok(ocrText, sendResponse) {
  try {
    console.log('Starting Grok analysis with text:', ocrText);
    console.log('Using Grok API key:', GROK_API_KEY ? 'Key present' : 'Key missing');
    
    if (!GROK_API_KEY || GROK_API_KEY === '{{GROK_API_KEY}}') {
      throw new Error('Grok API key not configured - please run npm run build with valid .env file');
    }
    
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + GROK_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'system',
            content: 'You are a product analyzer for a flipping app. Your job is to extract the CORE product name, price, and currency from text scraped from a Facebook Marketplace item page.\n\nThe text will contain Facebook UI elements like "Number of unread notifications", navigation elements, and other noise. You need to identify the ACTUAL PRODUCT being sold.\n\nRules:\n1. Extract ONLY the core product name - remove seller descriptions like condition, accessories, or personal notes\n2. Remove condition words: "Barely Used", "Excellent Condition", "Like New", "Used", "Fair", "Good", etc.\n3. Remove accessory mentions: "(with Controllers)", "(includes case)", "(with charger)", etc.\n4. Remove seller notes: "Must Go", "Quick Sale", "Price Negotiable", etc.\n5. Keep essential product identifiers: Brand, Model, Size, Color, Storage capacity\n6. Find the price (look for $ followed by numbers, or other currency symbols)\n7. Identify the currency (USD, AUD, EUR, GBP, CAD, etc.)\n8. If you find a clear product, price, and currency, respond in JSON: {"title": "Core Product Name", "price": 123.45, "currency": "USD"}\n9. If you cannot clearly identify all three, respond: {"error": "Cannot Interpret Product"}\n\nCurrency Detection:\n- $ = Usually USD, but check context (AU$ = AUD, CA$ = CAD, etc.)\n- € = EUR\n- £ = GBP\n- ¥ = JPY\n- If no clear currency symbol, assume USD\n\nExample transformations:\n"iPhone 12 Pro Max 256GB Unlocked - Excellent Condition (with charger)" → "iPhone 12 Pro Max 256GB Unlocked"\n"Meta Quest 3S - Barely Used, Excellent Condition (with Controllers)" → "Meta Quest 3S"\n"2015 Honda Civic LX - Good Condition, Low Miles" → "2015 Honda Civic LX"\n"MacBook Pro 13 inch M1 - Like New (includes case and charger)" → "MacBook Pro 13 inch M1"\n"Xbox Series X Console - Used but works perfectly" → "Xbox Series X Console"\n\nGood responses:\n{"title": "iPhone 12 Pro Max 256GB", "price": 450.00, "currency": "USD"}\n{"title": "Meta Quest 3S", "price": 400.00, "currency": "AUD"}\n{"title": "MacBook Pro 13 inch M1", "price": 1200.00, "currency": "USD"}'
          },
          {
            role: 'user',
            content: 'Analyze this text from a Facebook Marketplace item page and extract the product title, price, and currency:\n\n' + ocrText
          }
        ],
        model: 'grok-3-mini',
        temperature: 0.1
      })
    });

    console.log('Grok API response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Grok API error response:', errorText);
      throw new Error('Grok API error: ' + response.status + ' - ' + errorText);
    }

    const data = await response.json();
    console.log('Grok API response data:', data);
    
    const grokResponse = data.choices[0].message.content;
    console.log('Grok response content:', grokResponse);
    
    try {
      const parsed = JSON.parse(grokResponse);
      console.log('Parsed Grok response:', parsed);
      
      // If we have price and currency, convert to USD
      if (parsed.price && parsed.currency && !parsed.error) {
        console.log('=== CURRENCY CONVERSION ===');
        console.log('Original price:', parsed.price, parsed.currency);
        
        const usdPrice = await convertToUSD(parsed.price, parsed.currency);
        console.log('Converted USD price:', usdPrice);
        
        // Send back the result with USD price
        sendResponse({
          title: parsed.title,
          price: usdPrice,
          originalPrice: parsed.price,
          originalCurrency: parsed.currency,
          currency: 'USD'
        });
      } else {
        sendResponse(parsed);
      }
    } catch (parseError) {
      console.error('Failed to parse Grok response as JSON:', parseError);
      console.log('Raw response that failed to parse:', grokResponse);
      
      if (grokResponse.toLowerCase().indexOf('cannot interpret') !== -1) {
        sendResponse({ error: 'Cannot Interpret Product' });
      } else {
        sendResponse({ error: 'Could not parse Grok response: ' + grokResponse });
      }
    }
    
  } catch (error) {
    console.error('Grok analysis error:', error);
    sendResponse({ error: 'Failed to analyze with Grok: ' + error.message });
  }
}

// Simple currency conversion function
async function convertToUSD(amount, fromCurrency) {
  try {
    // If already USD, no conversion needed
    if (fromCurrency === 'USD') {
      return amount;
    }
    
    console.log('Converting ' + amount + ' ' + fromCurrency + ' to USD');
    
    // Use a free exchange rate API
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/' + fromCurrency);
    
    if (!response.ok) {
      console.error('Exchange rate API failed, using fallback rates');
      return convertWithFallbackRates(amount, fromCurrency);
    }
    
    const data = await response.json();
    const usdRate = data.rates.USD;
    
    if (!usdRate) {
      console.error('USD rate not found, using fallback');
      return convertWithFallbackRates(amount, fromCurrency);
    }
    
    const convertedAmount = amount * usdRate;
    console.log('Conversion: ' + amount + ' ' + fromCurrency + ' = ' + convertedAmount + ' USD (rate: ' + usdRate + ')');
    
    return parseFloat(convertedAmount.toFixed(2));
    
  } catch (error) {
    console.error('Currency conversion error:', error);
    console.log('Using fallback conversion rates');
    return convertWithFallbackRates(amount, fromCurrency);
  }
}

// Fallback currency conversion with approximate rates
function convertWithFallbackRates(amount, fromCurrency) {
  const fallbackRates = {
    'AUD': 0.67,  // 1 AUD = 0.67 USD (approximate)
    'EUR': 1.10,  // 1 EUR = 1.10 USD (approximate)
    'GBP': 1.27,  // 1 GBP = 1.27 USD (approximate)
    'CAD': 0.74,  // 1 CAD = 0.74 USD (approximate)
    'JPY': 0.0067, // 1 JPY = 0.0067 USD (approximate)
    'USD': 1.00   // 1 USD = 1.00 USD
  };
  
  const rate = fallbackRates[fromCurrency] || 1.0;
  const convertedAmount = amount * rate;
  
  console.log('Fallback conversion: ' + amount + ' ' + fromCurrency + ' = ' + convertedAmount + ' USD (fallback rate: ' + rate + ')');
  
  return parseFloat(convertedAmount.toFixed(2));
}

async function searchEbaySoldListings(productTitle, sendResponse) {
  try {
    // Check rate limiting
    const now = Date.now();
    const timeSinceLastCall = now - lastEbayCall;
    
    if (timeSinceLastCall < EBAY_RATE_LIMIT_MS) {
      const waitTime = EBAY_RATE_LIMIT_MS - timeSinceLastCall;
      console.log('🕐 Rate limiting: waiting ' + waitTime + 'ms before eBay call');
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    lastEbayCall = Date.now();
    
    console.log('=== EBAY API DEBUG START ===');
    console.log('Product title received:', productTitle);
    console.log('eBay API key length:', EBAY_API_KEY ? EBAY_API_KEY.length : 'No key');
    console.log('Time since last call:', timeSinceLastCall + 'ms');
    
    if (!EBAY_API_KEY || EBAY_API_KEY === '{{EBAY_API_KEY}}') {
      throw new Error('eBay API key not configured - please run npm run build with valid .env file');
    }
    
    // Clean the product title for eBay search
    const searchQuery = encodeURIComponent(productTitle);
    console.log('Encoded search query:', searchQuery);
    
    // Try to use the Analytics API for sold listings first
    console.log('🔍 Attempting Analytics API first...');
    try {
      const soldData = await fetchSoldListings(searchQuery);
      console.log('✅ Analytics API succeeded:', soldData);
      sendResponse(soldData);
      return;
    } catch (analyticsError) {
      console.log('❌ Analytics API failed:', analyticsError.message);
      console.log('🔄 Falling back to Browse API...');
      
      // Fallback: Use Browse API with simpler query to avoid rate limiting issues
      const apiUrl = 'https://api.ebay.com/buy/browse/v1/item_summary/search?q=' + searchQuery + '&limit=10';
      console.log('Browse API URL (simplified):', apiUrl);
      
      const headers = {
        'Authorization': 'Bearer ' + EBAY_API_KEY,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
      };
      
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: headers
      });

      console.log('Browse API response status:', response.status);
      console.log('Browse API response status text:', response.statusText);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Browse API full error response:', errorText);
        
        if (response.status === 401) {
          throw new Error('eBay API Authentication Failed (401). Your OAuth token may have expired.');
        } else if (response.status === 429) {
          throw new Error('eBay API Rate Limit Exceeded (429). Please wait 30 seconds and try again.');
        }
        
        throw new Error('eBay API error: ' + response.status + ' - ' + errorText);
      }

      const data = await response.json();
      console.log('✅ Browse API success - Raw response structure:', {
        total: data.total,
        itemSummariesLength: data.itemSummaries ? data.itemSummaries.length : 0,
        href: data.href,
        limit: data.limit,
        offset: data.offset
      });
      
      if (data.itemSummaries && data.itemSummaries.length > 0) {
        console.log('First item example:', {
          title: data.itemSummaries[0].title,
          price: data.itemSummaries[0].price,
          condition: data.itemSummaries[0].condition
        });
      } else {
        console.log('⚠️ eBay returned 0 items - likely rate limited or search term too specific');
        console.log('Full response:', data);
      }
      
      // Process items
      const relevantItems = data.itemSummaries ? data.itemSummaries.slice(0, 10) : [];
      console.log('Relevant items after slicing:', relevantItems.length);
      
      const processedItems = [];
      for (var i = 0; i < relevantItems.length; i++) {
        var item = relevantItems[i];
        var hasPrice = item.price && item.price.value;
        if (!hasPrice) {
          console.log('Item missing price:', item.title);
        } else {
          processedItems.push({
            title: item.title,
            price: {
              value: parseFloat(item.price.value),
              currency: item.price.currency
            },
            condition: item.condition,
            itemWebUrl: item.itemWebUrl
          });
        }
      }
      
      var finalItems = processedItems.slice(0, 3);
      
      console.log('Final processed items count:', finalItems.length);
      console.log('Processed items:', finalItems);
      
      const result = {
        items: finalItems,
        total: finalItems.length,
        note: finalItems.length === 0 ? 
          'No items found - may be rate limited. Wait 30 seconds and try again.' :
          'Showing recent market prices (current listings)'
      };
      
      console.log('=== EBAY API DEBUG END ===');
      sendResponse(result);
    }
    
  } catch (error) {
    console.error('=== EBAY API CRITICAL ERROR ===');
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);
    sendResponse({ 
      error: 'Failed to search eBay: ' + error.message,
      items: [],
      total: 0
    });
  }
}

// Attempt to use eBay Analytics API for real sold data
async function fetchSoldListings(searchQuery) {
  const analyticsUrl = 'https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search?q=' + searchQuery + '&filter=soldDate:[2024-01-01..2024-12-31]&limit=3&sort=soldDate';
  
  const headers = {
    'Authorization': 'Bearer ' + EBAY_API_KEY,
    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    'Content-Type': 'application/json'
  };
  
  console.log('Trying Analytics API for sold data...');
  console.log('Analytics URL:', analyticsUrl);
  
  const response = await fetch(analyticsUrl, {
    method: 'GET',
    headers: headers
  });
  
  console.log('Analytics API response status:', response.status);
  
  if (!response.ok) {
    const errorText = await response.text();
    console.log('Analytics API error (expected for some accounts):', errorText);
    throw new Error('Analytics API not available');
  }
  
  const data = await response.json();
  console.log('Analytics API sold data:', data);
  
  if (data.itemSales && data.itemSales.length > 0) {
    var soldItems = [];
    for (var i = 0; i < Math.min(3, data.itemSales.length); i++) {
      var item = data.itemSales[i];
      soldItems.push({
        title: item.title,
        price: {
          value: parseFloat(item.price.value),
          currency: item.price.currency
        },
        soldDate: item.soldDate,
        condition: item.condition
      });
    }
    
    return {
      items: soldItems,
      total: soldItems.length,
      note: 'Based on actual sold listings from eBay Analytics API'
    };
  }
  
  throw new Error('No sold data found');
}

// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
  console.log('FlipFinder extension installed');
  console.log('Grok API Key configured:', GROK_API_KEY && GROK_API_KEY !== '{{GROK_API_KEY}}' ? 'Yes' : 'No');
  console.log('eBay API Key configured:', EBAY_API_KEY && EBAY_API_KEY !== '{{EBAY_API_KEY}}' ? 'Yes' : 'No');
});