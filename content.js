// FlipFinder Content Script
var isAnalyzing = false;
var flipFinderButton = null;

// Initialize when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

function init() {
  // Only run on marketplace item pages
  if (window.location.href.indexOf('marketplace/item/') !== -1) {
    createFlipFinderButton();
  }
  
  // Listen for navigation changes (Facebook is SPA)
  var currentUrl = window.location.href;
  var observer = new MutationObserver(function() {
    if (window.location.href !== currentUrl) {
      currentUrl = window.location.href;
      if (currentUrl.indexOf('marketplace/item/') !== -1) {
        setTimeout(createFlipFinderButton, 1000);
      } else {
        removeFlipFinderButton();
      }
      
      // Clean up old cache entries when navigating away
      cleanupOldCache();
    }
  });
  
  observer.observe(document.body, { childList: true, subtree: true });
}

// Clean up old cache entries to prevent localStorage bloat
function cleanupOldCache() {
  try {
    // Since we're now using a single cache entry, just check if it's older than 24 hours
    var cachedData = localStorage.getItem('flipfinder_last_analysis');
    if (cachedData) {
      var cached = JSON.parse(cachedData);
      var age = Date.now() - (cached.timestamp || 0);
      var maxAge = 24 * 60 * 60 * 1000; // 24 hours
      
      if (age > maxAge) {
        localStorage.removeItem('flipfinder_last_analysis');
        console.log('Cleaned up old cache entry (older than 24 hours)');
      }
    }
  } catch (error) {
    console.log('Cache cleanup failed:', error);
  }
}

function createFlipFinderButton() {
  // Remove existing button if any
  removeFlipFinderButton();
  
  // Create floating button
  flipFinderButton = document.createElement('div');
  flipFinderButton.id = 'flipfinder-button';
  
  var buttonHTML = '<div class="ff-button">' +
    '<div class="ff-icon">💰</div>' +
    '<div class="ff-text">Check Profit</div>' +
    '</div>';
  
  flipFinderButton.innerHTML = buttonHTML;
  flipFinderButton.addEventListener('click', analyzeItem);
  document.body.appendChild(flipFinderButton);
}

function removeFlipFinderButton() {
  if (flipFinderButton) {
    flipFinderButton.remove();
    flipFinderButton = null;
  }
}

function analyzeItem() {
  if (isAnalyzing) return;
  
  // Get the current URL for this item
  var currentUrl = window.location.href;
  console.log('=== URL COMPARISON CHECK ===');
  console.log('Current URL:', currentUrl);
  
  // Check if we have any cached data and if it matches current URL
  try {
    var cachedData = localStorage.getItem('flipfinder_last_analysis');
    if (cachedData) {
      var cached = JSON.parse(cachedData);
      console.log('Found cached data for URL:', cached.url);
      console.log('Current URL matches cached URL:', currentUrl === cached.url);
      
      if (currentUrl === cached.url) {
        console.log('=== USING CACHED DATA ===');
        console.log('URLs match exactly - showing cached results');
        var results = cached.results;
        results.fromCache = true; // Mark as cached for display
        showResults(results);
        return;
      } else {
        console.log('=== URLs DIFFERENT - FRESH ANALYSIS ===');
        console.log('This is a different product, proceeding with new analysis');
      }
    } else {
      console.log('=== NO CACHE FOUND ===');
      console.log('No previous analysis found, proceeding with fresh analysis');
    }
  } catch (error) {
    console.log('Cache check failed, proceeding with fresh analysis:', error);
  }
  
  isAnalyzing = true;
  updateButtonState('analyzing');
  
  // Step 1: Take screenshot
  updateButtonState('screenshot');
  takeScreenshot().then(function(screenshot) {
    // Step 2: Extract text from page
    updateButtonState('ocr');
    return performOCR(screenshot);
  }).then(function(extractedText) {
    console.log('=== EXTRACTED TEXT FOR GROK ===');
    console.log(extractedText);
    
    // Step 3: Grok Analysis
    updateButtonState('grok');
    return analyzeWithGrok(extractedText);
  }).then(function(productInfo) {
    console.log('=== GROK OUTPUT ===');
    console.log('Raw Grok Response:', productInfo);
    console.log('Product Title:', productInfo.title);
    console.log('Original Price:', productInfo.originalPrice, productInfo.originalCurrency);
    console.log('Converted USD Price:', productInfo.price);
    
    if (productInfo.error) {
      console.log('❌ Grok Error:', productInfo.error);
      showResults({ error: productInfo.error });
      return;
    }
    
    // Step 4: eBay API
    updateButtonState('ebay');
    console.log('=== SEARCHING EBAY FOR ===');
    console.log('Search Term:', productInfo.title);
    
    return searchEbaySoldListings(productInfo.title).then(function(ebayData) {
      console.log('=== EBAY LISTINGS FOUND ===');
      console.log('Total Items Found:', ebayData.total);
      console.log('Note:', ebayData.note);
      
      if (ebayData.items && ebayData.items.length > 0) {
        console.log('--- Individual eBay Listings ---');
        for (var i = 0; i < ebayData.items.length; i++) {
          var item = ebayData.items[i];
          console.log('Listing ' + (i + 1) + ':');
          console.log('  Title:', item.title);
          console.log('  Price:', item.price.value, item.price.currency);
          console.log('  Condition:', item.condition);
          console.log('  URL:', item.itemWebUrl);
          console.log('---');
        }
        
        var prices = [];
        for (var j = 0; j < ebayData.items.length; j++) {
          prices.push(ebayData.items[j].price.value);
        }
        var avgPrice = prices.reduce(function(a, b) { return a + b; }, 0) / prices.length;
        console.log('💰 Price Analysis:');
        console.log('  Individual Prices:', prices);
        console.log('  Average Price:', avgPrice.toFixed(2));
        console.log('  Facebook Price (USD):', productInfo.price);
        console.log('  Potential Profit:', (avgPrice - productInfo.price).toFixed(2));
      } else {
        console.log('❌ No eBay listings found');
      }
      
      // Step 5: Calculate and show results
      var results = calculateProfitMargin(productInfo, ebayData);
      console.log('=== FINAL PROFIT CALCULATION ===');
      console.log('Results:', results);
      
      // Cache the results with the current URL
      try {
        var cacheData = {
          url: window.location.href,  // Store the URL with the results
          results: results,
          timestamp: Date.now()
        };
        localStorage.setItem('flipfinder_last_analysis', JSON.stringify(cacheData));
        console.log('=== CACHED RESULTS ===');
        console.log('Saved analysis with URL:', window.location.href);
      } catch (cacheError) {
        console.log('Could not cache results:', cacheError);
      }
      
      showResults(results);
    });
  }).catch(function(error) {
    console.error('❌ FlipFinder Error:', error);
    showResults({ error: 'Analysis failed. Please try again.' });
  }).finally(function() {
    isAnalyzing = false;
    setTimeout(function() { updateButtonState('ready'); }, 3000);
  });
}

function updateButtonState(state) {
  if (!flipFinderButton) return;
  
  var button = flipFinderButton.querySelector('.ff-button');
  var icon = flipFinderButton.querySelector('.ff-icon');
  var text = flipFinderButton.querySelector('.ff-text');
  
  switch (state) {
    case 'analyzing':
      button.classList.add('ff-analyzing');
      icon.textContent = '⏳';
      text.textContent = 'Analyzing...';
      break;
    case 'screenshot':
      icon.textContent = '📸';
      text.textContent = 'Taking Screenshot...';
      break;
    case 'ocr':
      icon.textContent = '👁️';
      text.textContent = 'Reading Text...';
      break;
    case 'ocr-fallback':
      icon.textContent = '🔍';
      text.textContent = 'Extracting Text...';
      break;
    case 'grok':
      icon.textContent = '🧠';
      text.textContent = 'AI Analysis...';
      break;
    case 'ebay':
      icon.textContent = '🔍';
      text.textContent = 'Checking eBay...';
      break;
    case 'ready':
    default:
      button.classList.remove('ff-analyzing');
      icon.textContent = '💰';
      text.textContent = 'Check Profit';
      break;
  }
}

function takeScreenshot() {
  return new Promise(function(resolve) {
    chrome.runtime.sendMessage({ action: 'takeScreenshot' }, resolve);
  });
}

function performOCR(screenshotDataUrl) {
  try {
    updateButtonState('ocr-fallback');
    var fallbackText = extractTextFromPage();
    
    if (fallbackText) {
      console.log('Using fallback text extraction:', fallbackText);
      return Promise.resolve(fallbackText);
    }
    
    throw new Error('No text could be extracted from page');
    
  } catch (error) {
    console.error('OCR Error:', error);
    return Promise.reject(error);
  }
}

function extractTextFromPage() {
  try {
    // Get all text from the page
    var allText = document.body.innerText;
    var lines = allText.split('\n').filter(function(line) { 
      return line.trim().length > 0; 
    });
    
    console.log('Extracting text from page...');
    console.log('Total lines found:', lines.length);
    console.log('First 30 lines:', lines.slice(0, 30));
    
    // Filter out Facebook navigation/menu noise
    var filteredLines = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var lowerLine = line.toLowerCase().trim();
      
      // Filter out common Facebook navigation and menu items
      var noisePatterns = [
        'marketplace',
        'browse all',
        'notifications',
        'inbox',
        'marketplace access',
        'buying',
        'selling',
        'create new listing',
        'location',
        'categories',
        'vehicles',
        'property for rent',
        'classifieds',
        'search marketplace',
        'within 20 km',
        'sydney, australia',
        'facebook',
        'home',
        'friends',
        'groups',
        'gaming',
        'watch',
        'profile',
        'settings',
        'menu',
        'share',
        'save',
        'like',
        'comment',
        'message seller',
        'send seller a message',
        'number of unread notifications'
      ];
      
      // Check if line contains navigation noise
      var isNoise = false;
      for (var j = 0; j < noisePatterns.length; j++) {
        if (lowerLine.indexOf(noisePatterns[j]) !== -1) {
          isNoise = true;
          break;
        }
      }
      
      // Also filter out very short lines (likely UI elements)
      var isTooShort = line.trim().length < 3;
      
      if (!isNoise && !isTooShort) {
        filteredLines.push(line);
      }
    }
    
    console.log('Filtered out noise, remaining lines:', filteredLines.length);
    console.log('Clean lines:', filteredLines.slice(0, 30));
    
    // Send first 30 clean lines to Grok for analysis
    var contextLines = filteredLines.slice(0, 30);
    var contextText = contextLines.join('\n');
    
    console.log('Sending this clean text to Grok for analysis:', contextText);
    return contextText;
    
  } catch (error) {
    console.error('Text extraction failed:', error);
    return null;
  }
}

function analyzeWithGrok(extractedText) {
  return new Promise(function(resolve) {
    chrome.runtime.sendMessage({
      action: 'analyzeWithGrok',
      text: extractedText
    }, resolve);
  });
}

function searchEbaySoldListings(productTitle) {
  return new Promise(function(resolve) {
    chrome.runtime.sendMessage({
      action: 'searchEbay',
      title: productTitle
    }, resolve);
  });
}

function calculateProfitMargin(productInfo, ebayData) {
  if (!ebayData || !ebayData.items || ebayData.items.length === 0) {
    return {
      error: 'No recent sales found on eBay for this item'
    };
  }
  
  // Calculate average sold price
  var soldPrices = [];
  for (var i = 0; i < ebayData.items.length; i++) {
    var price = parseFloat(ebayData.items[i].price.value);
    if (!isNaN(price)) {
      soldPrices.push(price);
    }
  }
  
  if (soldPrices.length === 0) {
    return {
      error: 'Could not parse eBay pricing data'
    };
  }
  
  var avgSoldPrice = soldPrices.reduce(function(a, b) { return a + b; }, 0) / soldPrices.length;
  var facebookPriceUSD = productInfo.price; // This is now in USD after conversion
  var grossProfit = avgSoldPrice - facebookPriceUSD;
  var profitMargin = ((grossProfit / avgSoldPrice) * 100);
  
  return {
    productTitle: productInfo.title,
    facebookPrice: facebookPriceUSD,
    originalPrice: productInfo.originalPrice,
    originalCurrency: productInfo.originalCurrency,
    avgEbayPrice: avgSoldPrice,
    grossProfit: grossProfit,
    profitMargin: profitMargin,
    salesCount: soldPrices.length,
    ebayListings: ebayData.items, // Pass the eBay listings for the View Listings feature
    recommendation: grossProfit > 20 ? 'Good flip opportunity!' : 
                   grossProfit > 10 ? 'Marginal profit' : 'Low profit potential'
  };
}

function showResults(results) {
  // Remove existing results
  var existingResults = document.querySelector('#flipfinder-results');
  if (existingResults) {
    existingResults.remove();
  }
  
  // Create results overlay
  var resultsDiv = document.createElement('div');
  resultsDiv.id = 'flipfinder-results';
  
  if (results.error) {
    var errorHTML = '<div class="ff-results-container ff-error">' +
      '<div class="ff-results-header">' +
      '<h3>Analysis Error</h3>' +
      '<button class="ff-close">×</button>' +
      '</div>' +
      '<div class="ff-results-content">' +
      '<p>' + results.error + '</p>' +
      '</div>' +
      '</div>';
    
    resultsDiv.innerHTML = errorHTML;
  } else {
    var profitColor = results.grossProfit > 20 ? '#10b981' : 
                     results.grossProfit > 10 ? '#f59e0b' : '#ef4444';
    
    var priceDisplay = results.originalPrice ? 
      results.originalCurrency + ' ' + results.originalPrice.toFixed(2) + ' ($' + results.facebookPrice.toFixed(2) + ' USD)' : 
      '$' + results.facebookPrice.toFixed(2);
    
    var successHTML = '<div class="ff-results-container">' +
      '<div class="ff-results-header">' +
      '<h3>Flip Analysis</h3>' +
      '<button class="ff-close">×</button>' +
      '</div>' +
      '<div class="ff-results-content">' +
      '<div class="ff-product-title">' + results.productTitle + '</div>' +
      '<div class="ff-price-comparison">' +
      '<div class="ff-price-item">' +
      '<span class="ff-price-label">Facebook Price:</span>' +
      '<span class="ff-price-value">' + priceDisplay + '</span>' +
      '</div>' +
      '<div class="ff-price-item">' +
      '<span class="ff-price-label">Avg eBay Price:</span>' +
      '<span class="ff-price-value">$' + results.avgEbayPrice.toFixed(2) + ' USD</span>' +
      '</div>' +
      '<div class="ff-price-item ff-profit" style="color: ' + profitColor + '">' +
      '<span class="ff-price-label">Potential Profit:</span>' +
      '<span class="ff-price-value">$' + results.grossProfit.toFixed(2) + ' (' + results.profitMargin.toFixed(1) + '%)</span>' +
      '</div>' +
      '</div>' +
      '<div class="ff-recommendation" style="color: ' + profitColor + '">' +
      results.recommendation +
      '</div>' +
      '<div class="ff-stats">' +
      'Based on last ' + results.salesCount + ' sold items on eBay' +
      (results.fromCache ? ' • <span style="color: #10b981; font-weight: 600;">⚡ Cached Result</span>' : '') +
      '</div>' +
      '<button class="ff-view-listings-btn">View Listings</button>' +
      '<div class="ff-listings-details" style="display: none;"></div>' +
      '</div>' +
      '</div>';
    
    resultsDiv.innerHTML = successHTML;
    
    // Store the listings data for later use
    resultsDiv.setAttribute('data-listings', JSON.stringify(results.ebayListings || []));
  }
  
  // Add event listener for close button
  var closeBtn = resultsDiv.querySelector('.ff-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', function() {
      resultsDiv.remove();
    });
  }
  
  // Add event listener for view listings button
  var viewListingsBtn = resultsDiv.querySelector('.ff-view-listings-btn');
  if (viewListingsBtn) {
    viewListingsBtn.addEventListener('click', function() {
      toggleListingsView(resultsDiv);
    });
  }
  
  document.body.appendChild(resultsDiv);
  
  // Removed auto-hide timer - user must manually close with X button
}

function toggleListingsView(resultsDiv) {
  var listingsDetails = resultsDiv.querySelector('.ff-listings-details');
  var viewBtn = resultsDiv.querySelector('.ff-view-listings-btn');
  
  if (listingsDetails.style.display === 'none') {
    // Show listings
    var listingsData = JSON.parse(resultsDiv.getAttribute('data-listings') || '[]');
    
    if (listingsData.length === 0) {
      listingsDetails.innerHTML = '<div class="ff-no-listings">No detailed listings available</div>';
    } else {
      var listingsHTML = '<div class="ff-listings-header">eBay Listings Used in Analysis</div>';
      
      for (var i = 0; i < listingsData.length; i++) {
        var listing = listingsData[i];
        listingsHTML += '<div class="ff-listing-item">' +
          '<div class="ff-listing-header">Listing ' + (i + 1) + '</div>' +
          '<div class="ff-listing-details">' +
          '<div class="ff-listing-field">' +
          '<span class="ff-listing-label">Title:</span>' +
          '<span class="ff-listing-value">' + listing.title + '</span>' +
          '</div>' +
          '<div class="ff-listing-field">' +
          '<span class="ff-listing-label">Price:</span>' +
          '<span class="ff-listing-value">$' + listing.price.value.toFixed(2) + ' ' + listing.price.currency + '</span>' +
          '</div>' +
          '<div class="ff-listing-field">' +
          '<span class="ff-listing-label">Condition:</span>' +
          '<span class="ff-listing-value">' + (listing.condition || 'Not specified') + '</span>' +
          '</div>' +
          '<div class="ff-listing-actions">' +
          '<button class="ff-visit-btn" data-url="' + listing.itemWebUrl + '">Visit</button>' +
          '</div>' +
          '</div>' +
          '</div>';
      }
      
      listingsDetails.innerHTML = listingsHTML;
      
      // Add click handlers for visit buttons
      var visitBtns = listingsDetails.querySelectorAll('.ff-visit-btn');
      for (var j = 0; j < visitBtns.length; j++) {
        visitBtns[j].addEventListener('click', function() {
          var url = this.getAttribute('data-url');
          window.open(url, '_blank');
        });
      }
    }
    
    listingsDetails.style.display = 'block';
    viewBtn.textContent = 'Hide Listings';
  } else {
    // Hide listings
    listingsDetails.style.display = 'none';
    viewBtn.textContent = 'View Listings';
  }
}