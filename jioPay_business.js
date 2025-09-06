const puppeteer = require('puppeteer');
const { writeFile, mkdir } = require('fs').promises;
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

class JioPayBusinessScraper {
    constructor() {
        this.browser = null;
        this.page = null;
        this.baseUrl = 'https://jiopay.com/business';
        this.outputDir = './extracted_content';
        this.pdfDir = '/Users/davidbong/Documents/VizuaraLabs_LLMHandsOn/RAG_Assigment/pdf/';
        this.footerLinks = {
            general: [
                'About Us',
                'Help Center', 
                'Investor Relations',
                'Complaint Resolution',
                'JioPay Business Partner Program'
            ],
            products: [
                'JioPay for Business',
                'Payment Gateway',
                'Point of Sale',
                'UPI Hub',
                'Biller Centre',
                'JioPay Business App'
            ],
            legal: [
                'Privacy Policy',
                'Terms & Conditions',
                'Grievance Redressal Policy',
                'Merchant Onboarding & KYC-AML Policy',
                'BillPay Terms & Conditions'
            ]
        };
    }

    async initialize() {
        try {
            console.log('🚀 Initializing browser...');
            this.browser = await puppeteer.launch({
                headless: false,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
                ],
                defaultViewport: { width: 1366, height: 768 }
            });

            this.page = await this.browser.newPage();
            
            await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            
            // Create output directory
            await mkdir(this.outputDir, { recursive: true });
            
            console.log('✅ Browser initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize browser:', error);
            throw error;
        }
    }

    async downloadFile(url, filepath) {
        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https:') ? https : http;
            const file = fs.createWriteStream(filepath);
            
            protocol.get(url, (response) => {
                if (response.statusCode === 200) {
                    response.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        resolve();
                    });
                } else {
                    reject(new Error(`Failed to download: ${response.statusCode}`));
                }
            }).on('error', (err) => {
                reject(err);
            });
        });
    }

    /**
     * Comprehensive PDF detection and download for any page
     * @param {string} pageName - Name of the current page for logging
     * @returns {Promise<Array>} - Array of downloaded PDF info
     */
    async detectAndDownloadPDFs(pageName) {
        console.log(`🔍 Scanning for PDFs on: ${pageName}`);
        const downloadedPDFs = [];
        
        try {
            // Ensure PDF directory exists
            if (!fs.existsSync(this.pdfDir)) {
                await mkdir(this.pdfDir, { recursive: true });
                console.log(`📁 Created PDF directory: ${this.pdfDir}`);
            }

            // Wait for page to fully load
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Comprehensive PDF link detection
            const pdfLinks = await this.page.evaluate(() => {
                const links = [];
                
                // Method 1: Direct PDF links in href attributes
                const directLinks = Array.from(document.querySelectorAll('a[href*=".pdf"], a[href*="PDF"]'));
                directLinks.forEach(link => {
                    if (link.href && (link.href.includes('.pdf') || link.href.includes('PDF'))) {
                        links.push({
                            url: link.href,
                            text: link.textContent?.trim() || 'PDF Document',
                            type: 'direct'
                        });
                    }
                });

                // Method 2: Links with PDF-related text content
                const textLinks = Array.from(document.querySelectorAll('a, div[onclick], span[onclick]'));
                textLinks.forEach(element => {
                    const text = element.textContent?.toLowerCase() || '';
                    const onclick = element.getAttribute('onclick') || '';
                    
                    if (text.includes('pdf') || text.includes('download') || 
                        text.includes('document') || onclick.includes('.pdf')) {
                        
                        let url = element.href || '';
                        
                        // Extract URL from onclick if present
                        if (!url && onclick) {
                            const urlMatch = onclick.match(/['"]([^'"]*\.pdf[^'"]*)['"]/);
                            if (urlMatch) {
                                url = urlMatch[1];
                            }
                        }
                        
                        if (url) {
                            links.push({
                                url: url,
                                text: element.textContent?.trim() || 'PDF Document',
                                type: 'text-based'
                            });
                        }
                    }
                });

                // Method 3: Look for common PDF container patterns
                const containers = Array.from(document.querySelectorAll(
                    '.pdf-container, .document-list, .download-section, [class*="pdf"], [class*="document"]'
                ));
                
                containers.forEach(container => {
                    const containerLinks = container.querySelectorAll('a, div[onclick]');
                    containerLinks.forEach(link => {
                        const href = link.href || link.getAttribute('onclick') || '';
                        if (href.includes('.pdf') || href.includes('PDF')) {
                            links.push({
                                url: link.href || href,
                                text: link.textContent?.trim() || 'PDF Document',
                                type: 'container'
                            });
                        }
                    });
                });

                // Remove duplicates
                const uniqueLinks = links.filter((link, index, self) => 
                    index === self.findIndex(l => l.url === link.url)
                );
                
                return uniqueLinks;
            });

            console.log(`📄 Found ${pdfLinks.length} potential PDF links on ${pageName}`);

            // Download each PDF
            for (const [index, pdfLink] of pdfLinks.entries()) {
                try {
                    let pdfUrl = pdfLink.url;
                    
                    // Handle relative URLs
                    if (pdfUrl.startsWith('/')) {
                        const currentUrl = new URL(this.page.url());
                        pdfUrl = `${currentUrl.protocol}//${currentUrl.host}${pdfUrl}`;
                    } else if (!pdfUrl.startsWith('http')) {
                        const currentUrl = new URL(this.page.url());
                        pdfUrl = `${currentUrl.protocol}//${currentUrl.host}/${pdfUrl}`;
                    }

                    // Generate safe filename
                    const urlObj = new URL(pdfUrl);
                    let filename = path.basename(urlObj.pathname);
                    
                    if (!filename.endsWith('.pdf')) {
                        const safeName = pdfLink.text.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_');
                        filename = `${pageName}_${safeName}_${index + 1}.pdf`;
                    } else {
                        filename = `${pageName}_${filename}`;
                    }

                    const filepath = path.join(this.pdfDir, filename);
                    
                    console.log(`📥 Downloading: ${pdfLink.text} -> ${filename}`);
                    await this.downloadFile(pdfUrl, filepath);
                    
                    downloadedPDFs.push({
                        filename: filename,
                        originalUrl: pdfUrl,
                        text: pdfLink.text,
                        type: pdfLink.type
                    });
                    
                    console.log(`✅ Successfully downloaded: ${filename}`);
                    
                } catch (downloadError) {
                    console.error(`❌ Failed to download PDF: ${pdfLink.text}`, downloadError.message);
                }
            }

        } catch (error) {
            console.error(`❌ Error during PDF detection on ${pageName}:`, error.message);
        }

        return downloadedPDFs;
    }

    async downloadInvestorPDFs() {
        try {
            console.log('\n📄 Starting PDF download from Investor Relations page...');
            
            // Navigate to Investor Relations page
            await this.page.goto('https://jiopay.com/business/investor-relation', {
                waitUntil: 'networkidle0',
                timeout: 30000
            });

            // Wait for page to load completely
            await new Promise(resolve => setTimeout(resolve, 3000));

            console.log('Searching for PDF links...');
            
            // Look for PDF links using various selectors
            const pdfLinks = await this.page.evaluate(() => {
                const links = [];
                
                // Find all anchor tags that might contain PDF links
                const anchors = document.querySelectorAll('a');
                
                anchors.forEach(anchor => {
                    const href = anchor.href;
                    const text = anchor.textContent.trim();
                    
                    // Check if it's a PDF link
                    if (href && (href.includes('.pdf') || text.toLowerCase().includes('pdf') || 
                        text.includes('Notice') || text.includes('Annual Return') || 
                        text.includes('Policy') || text.includes('Remuneration'))) {
                        
                        links.push({
                            url: href,
                            text: text,
                            filename: text.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_') + '.pdf'
                        });
                    }
                });
                
                // Also look for clickable elements that might trigger PDF downloads
                const clickableElements = document.querySelectorAll('[onclick], button, .download, .pdf');
                clickableElements.forEach(element => {
                    const text = element.textContent.trim();
                    const onclick = element.getAttribute('onclick') || '';
                    
                    if (text && (text.includes('Notice') || text.includes('Annual Return') || 
                        text.includes('Policy') || text.includes('Remuneration') || 
                        onclick.includes('.pdf'))) {
                        
                        // Try to extract URL from onclick or data attributes
                        let url = onclick.match(/['"]([^'"]*\.pdf[^'"]*)['"]/);
                        if (url) {
                            links.push({
                                url: url[1],
                                text: text,
                                filename: text.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_') + '.pdf'
                            });
                        }
                    }
                });
                
                return links;
            });

            console.log(`Found ${pdfLinks.length} potential PDF links:`);
            pdfLinks.forEach((link, index) => {
                console.log(`${index + 1}. ${link.text} -> ${link.url}`);
            });

            // Create download directory if it doesn't exist
            if (!fs.existsSync(this.pdfDir)) {
                fs.mkdirSync(this.pdfDir, { recursive: true });
                console.log(`Created directory: ${this.pdfDir}`);
            }

            // Download each PDF
            let downloadCount = 0;
            for (const link of pdfLinks) {
                try {
                    let downloadUrl = link.url;
                    
                    // Handle relative URLs
                    if (downloadUrl.startsWith('/')) {
                        downloadUrl = 'https://jiopay.com' + downloadUrl;
                    } else if (!downloadUrl.startsWith('http')) {
                        downloadUrl = 'https://jiopay.com/business/' + downloadUrl;
                    }
                    
                    const filename = link.filename || path.basename(downloadUrl);
                    const filepath = path.join(this.pdfDir, filename);
                    
                    console.log(`Downloading: ${link.text}`);
                    console.log(`URL: ${downloadUrl}`);
                    console.log(`Saving to: ${filepath}`);
                    
                    await this.downloadFile(downloadUrl, filepath);
                    console.log(`✓ Downloaded: ${filename}`);
                    downloadCount++;
                    
                } catch (error) {
                    console.log(`✗ Failed to download ${link.text}: ${error.message}`);
                }
            }

            // If no direct PDF links found, try clicking on document names
            if (pdfLinks.length === 0) {
                console.log('No direct PDF links found. Trying to click on document names...');
                
                const documentNames = [
                    'Notice 17th AGM',
                    'Draft Annual Return FY 2023-24',
                    'Policy for Selection of Directors and Determining Director\'s Independence',
                    'Remuneration Policy for Directors, Key Managerial Personnel and other Employees'
                ];
                
                for (const docName of documentNames) {
                    try {
                        console.log(`Looking for: ${docName}`);
                        
                        // Try to find and click the document
                        const element = await this.page.$x(`//text()[contains(., '${docName}')]/parent::*`);
                        if (element.length > 0) {
                            console.log(`Found element for: ${docName}`);
                            
                            // Set up download behavior
                            await this.page._client.send('Page.setDownloadBehavior', {
                                behavior: 'allow',
                                downloadPath: this.pdfDir
                            });
                            
                            await element[0].click();
                            await new Promise(resolve => setTimeout(resolve, 3000));
                            
                            console.log(`✓ Clicked on: ${docName}`);
                        } else {
                            console.log(`✗ Could not find element for: ${docName}`);
                        }
                    } catch (error) {
                        console.log(`✗ Error clicking ${docName}: ${error.message}`);
                    }
                }
            }

            console.log('\n=== PDF Download Summary ===');
            
            // List downloaded files
            if (fs.existsSync(this.pdfDir)) {
                const files = fs.readdirSync(this.pdfDir).filter(file => file.endsWith('.pdf'));
                console.log(`Downloaded ${files.length} PDF files:`);
                files.forEach(file => {
                    const filepath = path.join(this.pdfDir, file);
                    const stats = fs.statSync(filepath);
                    console.log(`- ${file} (${Math.round(stats.size / 1024)} KB)`);
                });
                return { success: true, downloadCount: files.length, files: files };
            } else {
                console.log('No PDF files downloaded.');
                return { success: false, downloadCount: 0, files: [] };
            }
            
        } catch (error) {
            console.error('Error during PDF extraction:', error);
            return { success: false, error: error.message, downloadCount: 0, files: [] };
        }
    }

    async extractHelpCenter() {
        try {
            console.log('\n📋 Starting Enhanced Help Center extraction...');
            
            // Navigate to Help Center page
            await this.page.goto('https://jiopay.com/business/help-center', {
                waitUntil: 'networkidle0',
                timeout: 30000
            });

            // Wait for page to load completely
            await new Promise(resolve => setTimeout(resolve, 5000));

            console.log('🔍 Searching for expandable elements (arrows, accordions, collapsible sections)...');
            
            // Enhanced approach: Look for various types of expandable elements
            const expandableSelectors = [
                'button[role="button"]',
                'button[aria-expanded]',
                '.accordion-button',
                '.collapse-toggle',
                '[data-toggle="collapse"]',
                'button:has(svg)',
                'div[role="button"]',
                '.expandable',
                '.toggle-button',
                'button[class*="expand"]',
                'button[class*="arrow"]',
                '[class*="accordion"] button',
                'summary', // HTML5 details/summary elements
                '.faq-question',
                '.question-header'
            ];
            
            let allExpandableElements = [];
            
            // Find all expandable elements using multiple selectors
            for (const selector of expandableSelectors) {
                try {
                    const elements = await this.page.$$(selector);
                    if (elements.length > 0) {
                        console.log(`Found ${elements.length} elements with selector: ${selector}`);
                        allExpandableElements.push(...elements);
                    }
                } catch (error) {
                    // Continue with next selector if this one fails
                }
            }
            
            // Remove duplicates
            const uniqueElements = [...new Set(allExpandableElements)];
            console.log(`Total unique expandable elements found: ${uniqueElements.length}`);
            
            // Enhanced expansion strategy
            for (let i = 0; i < uniqueElements.length; i++) {
                try {
                    const element = uniqueElements[i];
                    
                    // Check if element is visible and clickable
                    const isVisible = await element.isIntersectingViewport();
                    if (!isVisible) {
                        await element.scrollIntoView();
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                    
                    // Get element info for logging
                    const elementInfo = await this.page.evaluate(el => {
                        return {
                            tagName: el.tagName,
                            className: el.className,
                            textContent: el.textContent?.trim().substring(0, 50),
                            ariaExpanded: el.getAttribute('aria-expanded'),
                            hasArrow: el.innerHTML.includes('arrow') || el.innerHTML.includes('▼') || el.innerHTML.includes('▲')
                        };
                    }, element);
                    
                    console.log(`Expanding element ${i + 1}: ${elementInfo.tagName}.${elementInfo.className} - "${elementInfo.textContent}"`);
                    
                    // Check if already expanded
                    if (elementInfo.ariaExpanded === 'true') {
                        console.log(`  ↳ Already expanded, skipping`);
                        continue;
                    }
                    
                    // Click the element
                    await element.click();
                    
                    // Wait for content to appear using multiple strategies
                    try {
                        // Strategy 1: Wait for aria-expanded to change
                        await this.page.waitForFunction(
                            (el) => el.getAttribute('aria-expanded') === 'true',
                            { timeout: 3000 },
                            element
                        );
                        console.log(`  ✅ Expansion confirmed via aria-expanded`);
                    } catch {
                        try {
                            // Strategy 2: Wait for new content to appear
                            await this.page.waitForFunction(
                                () => document.querySelectorAll('.accordion-body, .collapse-content, .faq-answer, .answer').length > 0,
                                { timeout: 3000 }
                            );
                            console.log(`  ✅ New content detected`);
                        } catch {
                            // Strategy 3: Just wait a bit for any animations
                            await new Promise(resolve => setTimeout(resolve, 1500));
                            console.log(`  ⏳ Waited for potential content`);
                        }
                    }
                    
                } catch (error) {
                    console.log(`  ⚠️ Error expanding element ${i + 1}: ${error.message}`);
                }
            }
            
            // Wait for all animations and dynamic content to settle
            console.log('⏳ Waiting for all content to stabilize...');
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // Enhanced content extraction with multiple strategies
            const extractedContent = await this.page.evaluate(() => {
                const qaList = [];
                
                // Strategy 1: Look for structured FAQ patterns
                const faqSelectors = [
                    '.faq-item',
                    '.accordion-item',
                    '.question-answer-pair',
                    '[class*="faq"]',
                    '[class*="question"]'
                ];
                
                for (const selector of faqSelectors) {
                    const faqItems = document.querySelectorAll(selector);
                    faqItems.forEach(item => {
                        const questionEl = item.querySelector('.question, .faq-question, h3, h4, summary, [class*="question"]');
                        const answerEl = item.querySelector('.answer, .faq-answer, .accordion-body, .collapse-content, [class*="answer"]');
                        
                        if (questionEl && answerEl) {
                            const question = questionEl.textContent.trim();
                            const answer = answerEl.textContent.trim();
                            if (question.length > 5 && answer.length > 10) {
                                qaList.push({ question, answer, source: 'structured' });
                            }
                        }
                    });
                }
                
                // Strategy 2: Look for expanded accordion content
                const expandedContent = document.querySelectorAll('[aria-expanded="true"] + *, .show .accordion-body, .collapse.show');
                expandedContent.forEach(content => {
                    const text = content.textContent.trim();
                    if (text.length > 20) {
                        // Try to find associated question
                        let question = 'General Information';
                        const prevElement = content.previousElementSibling;
                        if (prevElement) {
                            const prevText = prevElement.textContent.trim();
                            if (prevText.length > 5 && prevText.length < 200) {
                                question = prevText;
                            }
                        }
                        qaList.push({ question, answer: text, source: 'expanded' });
                    }
                });
                
                // Strategy 3: Enhanced question detection (original logic improved)
                const allElements = document.querySelectorAll('*');
                allElements.forEach(el => {
                    const text = el.textContent.trim();
                    
                    // Look for question patterns
                    if ((text.endsWith('?') || text.includes('How') || text.includes('What') || text.includes('Why')) && 
                        text.length > 10 && text.length < 300) {
                        
                        // Look for answer in various locations
                        const searchElements = [
                            el.nextElementSibling,
                            el.parentElement?.nextElementSibling,
                            el.closest('.faq-item, .accordion-item')?.querySelector('.answer, .accordion-body')
                        ];
                        
                        for (const searchEl of searchElements) {
                            if (searchEl) {
                                const answerText = searchEl.textContent.trim();
                                if (answerText.length > 20 && answerText.length < 2000 && !answerText.endsWith('?')) {
                                    qaList.push({ question: text, answer: answerText, source: 'detected' });
                                    break;
                                }
                            }
                        }
                    }
                });
                
                // Remove duplicates based on question similarity
                const uniqueQA = [];
                qaList.forEach(qa => {
                    const isDuplicate = uniqueQA.some(existing => 
                        existing.question.toLowerCase().includes(qa.question.toLowerCase().substring(0, 20)) ||
                        qa.question.toLowerCase().includes(existing.question.toLowerCase().substring(0, 20))
                    );
                    if (!isDuplicate) {
                        uniqueQA.push(qa);
                    }
                });
                
                return uniqueQA;
            });
            
            console.log(`📊 Extracted ${extractedContent.length} Q&A pairs using enhanced method`);
            
            // Create enhanced formatted output
            let formattedOutput = '=== ENHANCED HELP CENTER EXTRACTION ===\n\n';
            formattedOutput += `Extracted from: https://jiopay.com/business/help-center\n`;
            formattedOutput += `Page Title: JioPay Business Help Center\n`;
            formattedOutput += `Extraction Time: ${new Date().toISOString()}\n`;
            formattedOutput += `Total Expandable Elements Found: ${uniqueElements.length}\n`;
            formattedOutput += `Total Q&A Pairs Extracted: ${extractedContent.length}\n\n`;
            formattedOutput += '==================================================\n\n';
            
            extractedContent.forEach((qa, index) => {
                formattedOutput += `Q${index + 1}: ${qa.question}\n`;
                formattedOutput += `A${index + 1}: ${qa.answer}\n`;
                formattedOutput += `Source: ${qa.source}\n\n`;
                formattedOutput += '---\n\n';
            });
            
            // Save results
            await writeFile(path.join(this.outputDir, 'Help_Center_Enhanced.txt'), formattedOutput);
            
            const jsonData = {
                extractionTime: new Date().toISOString(),
                url: 'https://jiopay.com/business/help-center',
                totalExpandableElements: uniqueElements.length,
                totalQAPairs: extractedContent.length,
                qaData: extractedContent
            };
            
            await writeFile('help_center_enhanced_extraction.json', JSON.stringify(jsonData, null, 2));
            
            console.log('\n=== ENHANCED HELP CENTER EXTRACTION COMPLETE ===');
            console.log(`✓ Found and expanded ${uniqueElements.length} expandable elements`);
            console.log(`✓ Extracted ${extractedContent.length} Q&A pairs`);
            console.log('✓ Saved to extracted_content/Help_Center_Enhanced.txt');
            console.log('✓ Saved JSON to help_center_enhanced_extraction.json');
            
            return { success: true, totalQAPairs: extractedContent.length, qaData: extractedContent };
            
        } catch (error) {
            console.error('Error during Enhanced Help Center extraction:', error);
            return { success: false, error: error.message, totalQAPairs: 0, qaData: [] };
        }
    }

    async navigateToBaseWithRetry(timeout = 60000, maxAttempts = 3) {
        const userAgents = [
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ];
        
        const navigationStrategies = [
            { waitUntil: 'networkidle2', timeout: timeout },
            { waitUntil: 'networkidle0', timeout: timeout * 1.5 },
            { waitUntil: 'domcontentloaded', timeout: timeout * 0.8 },
            { waitUntil: 'load', timeout: timeout * 2 }
        ];
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            // Rotate user agent
            const userAgent = userAgents[(attempt - 1) % userAgents.length];
            await this.page.setUserAgent(userAgent);
            
            for (const strategy of navigationStrategies) {
                try {
                    console.log(`🌐 Navigation attempt ${attempt}/${maxAttempts}, strategy: ${strategy.waitUntil}`);
                    await this.page.goto(this.baseUrl, strategy);
                    
                    // Verify page loaded successfully
                    await this.page.waitForSelector('body', { timeout: 5000 });
                    console.log(`✅ Successfully navigated with strategy: ${strategy.waitUntil}`);
                    return true;
                } catch (navError) {
                    console.log(`⚠️ Strategy ${strategy.waitUntil} failed: ${navError.message}`);
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
                }
            }
        }
        return false;
    }
    
    async recoverBrowser() {
        try {
            console.log('🔄 Attempting browser recovery...');
            if (this.browser) {
                await this.browser.close();
            }
            await this.initialize();
            console.log('✅ Browser recovery successful');
            return true;
        } catch (error) {
            console.error('❌ Browser recovery failed:', error.message);
            return false;
        }
    }
    
    async tryDirectNavigation(linkText) {
        const directUrls = {
            'About Us': 'https://jiopay.com/business/about-us',
            'Help Center': 'https://jiopay.com/business/help-center',
            'Biller Centre': 'https://jiopay.com/business/biller-centre',
            'UPI Hub': 'https://jiopay.com/business/upi-hub',
            'JioPay Business App': 'https://jiopay.com/business/jiopay-business-app',
            'Payment Gateway': 'https://jiopay.com/business/payment-gateway',
            'Point of Sale': 'https://jiopay.com/business/point-of-sale',
            'Investor Relations': 'https://jiopay.com/business/investor-relation'
        };
        
        const directUrl = directUrls[linkText];
        if (directUrl) {
            try {
                console.log(`🎯 Trying direct navigation to: ${directUrl}`);
                await this.page.goto(directUrl, {
                    waitUntil: 'networkidle2',
                    timeout: 90000
                });
                return true;
            } catch (error) {
                console.log(`❌ Direct navigation failed: ${error.message}`);
                return false;
            }
        }
        return false;
    }
    
    async extractPageContent(linkText, slowLoad = false) {
        try {
            // Wait for page stability
            await this.page.waitForFunction(
                () => document.readyState === 'complete' && 
                      (!window.jQuery || window.jQuery.active === 0),
                { timeout: 15000 }
            ).catch(() => console.log('⚠️ Page stability timeout, proceeding anyway'));
            
            // Additional wait for slow-loading pages
            if (slowLoad) {
                await new Promise(resolve => setTimeout(resolve, 10000));
            }
            
            const content = await this.page.evaluate(() => {
                // Remove scripts, styles, and other non-content elements
                const scripts = document.querySelectorAll('script, style, noscript, link[rel="stylesheet"]');
                scripts.forEach(el => el.remove());
                
                // Enhanced removal of header, footer, and navigation elements
                const headerFooterSelectors = [
                    'header', 'footer', 'nav', '.header', '.footer', '.navigation',
                    '[role="banner"]', '[role="contentinfo"]', '[role="navigation"]',
                    '.navbar', '.nav-bar', '.top-nav', '.bottom-nav', '.breadcrumb'
                ];
                
                headerFooterSelectors.forEach(selector => {
                    const elements = document.querySelectorAll(selector);
                    elements.forEach(el => el.remove());
                });
                
                // Enhanced main content detection
                const mainContentSelectors = [
                    'main', '[role="main"]', '.main-content', '.content', 'article', '#content',
                    '.page-content', '.main-body', '.content-area', '.primary-content',
                    '.article-content', '.post-content', '.entry-content', '.page-body'
                ];
                
                let mainContent = '';
                
                for (const selector of mainContentSelectors) {
                    const element = document.querySelector(selector);
                    if (element && element.innerText && element.innerText.trim().length > 50) {
                        mainContent = element.innerText.trim();
                        break;
                    }
                }
                
                // Enhanced fallback content extraction
                if (!mainContent || mainContent.length < 50) {
                    const fallbackSelectors = [
                        '.container', '.wrapper', '.page-wrapper', '.content-wrapper',
                        '#main', '#primary', '.primary', '.main', '.body-content'
                    ];
                    
                    for (const selector of fallbackSelectors) {
                        const element = document.querySelector(selector);
                        if (element && element.innerText && element.innerText.trim().length > 100) {
                            mainContent = element.innerText.trim();
                            break;
                        }
                    }
                    
                    // Final fallback: clean body text
                    if (!mainContent || mainContent.length < 50) {
                        let bodyText = (document.body && document.body.innerText) ? document.body.innerText.trim() : '';
                        
                        if (bodyText) {
                            const lines = bodyText.split('\n');
                            const cleanLines = lines.filter(line => {
                                const trimmed = line.trim().toLowerCase();
                                return trimmed.length > 3 && 
                                       !trimmed.match(/^(jiopay business|products|partner program|contact us|about us|general|legal|home|login|register|search|menu|navigation|footer|header|copyright|privacy|terms)$/i) &&
                                       !trimmed.match(/^\s*$/) &&
                                       !trimmed.match(/^[\d\s\-\.]+$/);
                            });
                            
                            mainContent = cleanLines.join('\n').trim();
                        }
                    }
                }
                
                return mainContent || 'No content could be extracted from this page';
            });
            
            return content;
        } catch (error) {
            console.error(`⚠️ Content extraction failed: ${error.message}`);
            return 'Content extraction failed due to page error';
        }
    }

    async clickAndExtractContent(linkText) {
        console.log(`🔗 Attempting to click on: ${linkText}`);
        
        const pageConfigs = {
            'Payment Gateway': { timeout: 180000, strategy: 'enhanced', waitTime: 60000, retries: 6, slowLoad: true },
            'Point of Sale': { timeout: 180000, strategy: 'enhanced', waitTime: 60000, retries: 6, slowLoad: true },
            'UPI Hub': { timeout: 180000, strategy: 'enhanced', waitTime: 60000, retries: 6, slowLoad: true },
            'Biller Centre': { timeout: 240000, strategy: 'enhanced', waitTime: 90000, retries: 8, slowLoad: true },
            'JioPay Business App': { timeout: 180000, strategy: 'enhanced', waitTime: 60000, retries: 6, slowLoad: true },
            'Grievance Redressal Policy': { timeout: 180000, strategy: 'enhanced', waitTime: 60000, retries: 6, slowLoad: true },
            'Merchant Onboarding & KYC-AML Policy': { timeout: 180000, strategy: 'enhanced', waitTime: 60000, retries: 6, slowLoad: true },
            'BillPay Terms & Conditions': { timeout: 180000, strategy: 'enhanced', waitTime: 60000, retries: 6, slowLoad: true },
            'Investor Relations': { timeout: 120000, strategy: 'enhanced', waitTime: 45000, retries: 4, slowLoad: false }
        };
        
        const config = pageConfigs[linkText] || { timeout: 180000, strategy: 'enhanced', waitTime: 60000, retries: 5, slowLoad: true };
        const maxRetries = config.retries;
        let browserRecoveryCount = 0;
        
        let lastError;
        let downloadedPDFs = [];
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`📍 Attempt ${attempt}/${maxRetries} for: ${linkText}`);
                
                // Browser recovery every 2 failed attempts
                if (attempt > 1 && (attempt - 1) % 2 === 0 && browserRecoveryCount < 2) {
                    const recovered = await this.recoverBrowser();
                    if (recovered) {
                        browserRecoveryCount++;
                        console.log(`🔄 Browser recovered (${browserRecoveryCount}/2)`);
                    }
                }
                
                if (attempt > 1) {
                    // Exponential backoff with enhanced wait times
                    const baseWaitTime = config.slowLoad ? 20000 : 15000;
                    const backoffTime = Math.min(baseWaitTime * Math.pow(1.5, attempt - 1), 60000);
                    console.log(`⏳ Waiting ${backoffTime}ms before retry attempt ${attempt}...`);
                    await new Promise(resolve => setTimeout(resolve, backoffTime));
                }
                
                // Enhanced navigation with multiple fallback strategies
                let baseNavSuccess = false;
                
                // Strategy 1: Enhanced base URL navigation with retry
                baseNavSuccess = await this.navigateToBaseWithRetry(config.timeout * 0.5, 2);
                
                // Strategy 2: Try direct navigation if base navigation fails
                if (!baseNavSuccess) {
                    console.log('🎯 Base navigation failed, trying direct navigation...');
                    baseNavSuccess = await this.tryDirectNavigation(linkText);
                    if (baseNavSuccess) {
                        console.log('✅ Direct navigation successful, extracting content...');
                        // Extract content directly since we're already on the target page
                        const url = this.page.url();
                        const title = await this.page.title().catch(() => linkText);
                        
                        // Wait for page stability
                        await new Promise(resolve => setTimeout(resolve, 8000));
                        if (config.slowLoad) {
                            await new Promise(resolve => setTimeout(resolve, 15000));
                        }
                        
                        // Detect and download PDFs
                        try {
                            downloadedPDFs = await this.detectAndDownloadPDFs(linkText);
                        } catch (pdfError) {
                            console.error(`⚠️ PDF detection failed: ${pdfError.message}`);
                            downloadedPDFs = [];
                        }
                        
                        // Extract content
                        const content = await this.extractPageContent(linkText, config.slowLoad);
                        
                        return {
                            success: true,
                            title: title,
                            url: url,
                            content: content,
                            pdfs: downloadedPDFs,
                            timestamp: new Date().toISOString(),
                            method: 'direct_navigation'
                        };
                    }
                }
                
                if (!baseNavSuccess) {
                    if (attempt === maxRetries) {
                        throw new Error('Failed to navigate to base URL with all strategies after maximum retries');
                    }
                    console.log(`⚠️ Navigation attempt ${attempt} failed, will retry...`);
                    continue;
                }
                
                // Enhanced wait for page stability - longer for slow-loading pages
                const stabilityWait = config.slowLoad ? 8000 : 5000;
                await new Promise(resolve => setTimeout(resolve, stabilityWait));
                
                // Scroll to bottom to ensure footer is visible
                await this.page.evaluate(() => {
                    window.scrollTo(0, document.body.scrollHeight);
                });
                await new Promise(resolve => setTimeout(resolve, 3000));

                let linkElement = null;
                
                // Enhanced element finding with multiple strategies
                try {
                    linkElement = await this.page.evaluateHandle((text) => {
                        // Strategy 1: Exact text match in clickable divs
                        const clickableDivs = Array.from(document.querySelectorAll('div[tabindex="0"]'));
                        let foundDiv = clickableDivs.find(div => {
                            const textContent = div.textContent && div.textContent.trim();
                            return textContent === text;
                        });
                        
                        if (foundDiv) return foundDiv;
                        
                        // Strategy 2: Partial text match in clickable divs
                        foundDiv = clickableDivs.find(div => {
                            const textContent = div.textContent && div.textContent.trim();
                            return textContent && textContent.includes(text);
                        });
                        
                        if (foundDiv) return foundDiv;
                        
                        // Strategy 3: Anchor tags with exact match
                        const links = Array.from(document.querySelectorAll('a'));
                        let foundLink = links.find(link => 
                            link.textContent && link.textContent.trim() === text
                        );
                        
                        if (foundLink) return foundLink;
                        
                        // Strategy 4: Anchor tags with partial match
                        foundLink = links.find(link => 
                            link.textContent && link.textContent.trim().includes(text)
                        );
                        
                        return foundLink || null;
                    }, linkText);
                    
                    if (linkElement && await linkElement.evaluate(el => el !== null)) {
                        console.log(`✅ Found clickable element for: ${linkText}`);
                    } else {
                        linkElement = null;
                    }
                } catch (e) {
                    console.log(`⚠️ Could not find clickable element: ${e.message}`);
                    linkElement = null;
                }

                if (!linkElement) {
                    console.log(`❌ Could not find clickable element for: ${linkText}`);
                    return { success: false, content: `Link not found: ${linkText}`, pdfs: [] };
                }
                
                // Enhanced click and navigation with multiple strategies
                let navigationSuccessful = false;
                const originalUrl = this.page.url();
                
                // Strategy 1: Standard navigation with wait
                try {
                    console.log(`🔄 Attempting standard navigation for: ${linkText}`);
                    await Promise.all([
                        this.page.waitForNavigation({ 
                            waitUntil: 'domcontentloaded',
                            timeout: config.timeout
                        }),
                        linkElement.click()
                    ]);
                    navigationSuccessful = true;
                    console.log(`✅ Standard navigation successful for: ${linkText}`);
                } catch (navError) {
                    console.log(`⚠️ Standard navigation failed: ${navError.message}`);
                    
                    // Check if this is a timeout error - if so, skip this page
                    if (navError.message.includes('Navigation timeout') || navError.message.includes('timeout')) {
                        console.log(`⏭️ Skipping ${linkText} due to navigation timeout`);
                        return {
                            success: false,
                            error: 'Navigation timeout - page skipped',
                            url: null,
                            title: linkText,
                            content: `Navigation failed after timeout for: ${linkText}`,
                            pdfs: []
                        };
                    }
                    
                    // Strategy 2: Click and wait with networkidle
                    try {
                        console.log(`🔄 Attempting networkidle navigation for: ${linkText}`);
                        await linkElement.click();
                        await this.page.waitForNavigation({ 
                            waitUntil: 'networkidle0',
                            timeout: config.timeout
                        });
                        navigationSuccessful = true;
                        console.log(`✅ Networkidle navigation successful for: ${linkText}`);
                    } catch (networkError) {
                        console.log(`⚠️ Networkidle navigation failed: ${networkError.message}`);
                        
                        // Check for timeout again
                        if (networkError.message.includes('Navigation timeout') || networkError.message.includes('timeout')) {
                            console.log(`⏭️ Skipping ${linkText} due to networkidle timeout`);
                            return {
                                success: false,
                                error: 'Navigation timeout - page skipped',
                                url: null,
                                title: linkText,
                                content: `Navigation failed after timeout for: ${linkText}`,
                                pdfs: []
                            };
                        }
                        
                        // Strategy 3: Click and manual wait with URL check
                        try {
                            console.log(`🔄 Attempting manual wait navigation for: ${linkText}`);
                            await linkElement.click();
                            await new Promise(resolve => setTimeout(resolve, config.waitTime));
                            
                            const currentUrl = this.page.url();
                            if (currentUrl !== originalUrl) {
                                navigationSuccessful = true;
                                console.log(`✅ Manual wait navigation successful for: ${linkText}`);
                            } else {
                                // Strategy 4: Force click and extended wait
                                console.log(`🔄 Attempting force click for: ${linkText}`);
                                await linkElement.evaluate(el => el.click());
                                await new Promise(resolve => setTimeout(resolve, config.waitTime + 15000));
                                
                                const finalUrl = this.page.url();
                                if (finalUrl !== originalUrl) {
                                    navigationSuccessful = true;
                                    console.log(`✅ Force click navigation successful for: ${linkText}`);
                                }
                            }
                        } catch (manualError) {
                            console.log(`❌ All navigation strategies failed: ${manualError.message}`);
                        }
                    }
                }
                
                if (!navigationSuccessful) {
                    throw new Error('Navigation failed after all strategies attempted');
                }
                
                // Enhanced page stability detection
                console.log(`⏳ Waiting for page to stabilize: ${linkText}`);
                
                // Initial wait
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                // Wait for dynamic content to load
                try {
                    await this.page.waitForFunction(
                        () => document.readyState === 'complete' && 
                              (!window.jQuery || window.jQuery.active === 0),
                        { timeout: 15000 }
                    );
                    console.log(`✅ Page stability confirmed for: ${linkText}`);
                } catch (stabilityError) {
                    console.log(`⚠️ Page stability timeout, proceeding anyway: ${stabilityError.message}`);
                }
                
                // Additional wait for slow-loading pages
                if (config.slowLoad) {
                    await new Promise(resolve => setTimeout(resolve, 10000));
                }
                
                // **NEW: Detect and download PDFs on this page**
                try {
                    downloadedPDFs = await this.detectAndDownloadPDFs(linkText);
                    console.log(`📄 Downloaded ${downloadedPDFs.length} PDFs from: ${linkText}`);
                } catch (pdfError) {
                    console.error(`⚠️ PDF detection failed for ${linkText}:`, pdfError.message);
                    downloadedPDFs = [];
                }

                // Extract content with enhanced error handling
                const url = this.page.url();
                const title = await this.page.title().catch(() => 'Unknown Title');
                
                const content = await this.page.evaluate(() => {
                    // Wait for any remaining dynamic content
                    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
                    
                    // Remove scripts, styles, and other non-content elements
                    const scripts = document.querySelectorAll('script, style, noscript, link[rel="stylesheet"]');
                    scripts.forEach(el => el.remove());
                    
                    // Enhanced removal of header, footer, and navigation elements
                    const headerFooterSelectors = [
                        'header', 'footer', 'nav', '.header', '.footer', '.navigation',
                        '[role="banner"]', '[role="contentinfo"]', '[role="navigation"]',
                        '.navbar', '.nav-bar', '.top-nav', '.bottom-nav', '.breadcrumb'
                    ];
                    
                    headerFooterSelectors.forEach(selector => {
                        const elements = document.querySelectorAll(selector);
                        elements.forEach(el => el.remove());
                    });
                    
                    // Enhanced main content detection with more selectors
                    const mainContentSelectors = [
                        'main', '[role="main"]', '.main-content', '.content', 'article', '#content',
                        '.page-content', '.main-body', '.content-area', '.primary-content',
                        '.article-content', '.post-content', '.entry-content', '.page-body'
                    ];
                    
                    let mainContent = '';
                    
                    // Try each selector with enhanced validation
                    for (const selector of mainContentSelectors) {
                        const element = document.querySelector(selector);
                        if (element && element.innerText) {
                            let text = element.innerText.trim();
                            // More lenient content length check
                            if (text.length > 50) {
                                mainContent = text;
                                console.log(`Found content using selector: ${selector}`);
                                break;
                            }
                        }
                    }
                    
                    // Enhanced fallback content extraction
                    if (!mainContent || mainContent.length < 50) {
                        console.log('Main content selectors failed, trying fallback methods');
                        
                        // Fallback 1: Look for content containers
                        const fallbackSelectors = [
                            '.container', '.wrapper', '.page-wrapper', '.content-wrapper',
                            '#main', '#primary', '.primary', '.main', '.body-content'
                        ];
                        
                        for (const selector of fallbackSelectors) {
                            const element = document.querySelector(selector);
                            if (element && element.innerText && element.innerText.trim().length > 100) {
                                mainContent = element.innerText.trim();
                                console.log(`Found content using fallback selector: ${selector}`);
                                break;
                            }
                        }
                        
                        // Fallback 2: Get body content with enhanced filtering
                        if (!mainContent || mainContent.length < 50) {
                            let bodyText = (document.body && document.body.innerText) ? document.body.innerText.trim() : '';
                            
                            if (bodyText) {
                                const lines = bodyText.split('\n');
                                const cleanLines = lines.filter(line => {
                                    const trimmed = line.trim().toLowerCase();
                                    // Enhanced filtering of navigation and common elements
                                    return trimmed.length > 3 && 
                                           !trimmed.match(/^(jiopay business|products|partner program|contact us|about us|general|legal|home|login|register|search|menu|navigation|footer|header|copyright|privacy|terms)$/i) &&
                                           !trimmed.match(/^\s*$/) &&
                                           !trimmed.match(/^[\d\s\-\.]+$/);
                                });
                                
                                mainContent = cleanLines.join('\n').trim();
                                console.log('Used enhanced body text extraction');
                            }
                        }
                        
                        // Fallback 3: Try to get any meaningful text
                        if (!mainContent || mainContent.length < 20) {
                            const allText = document.documentElement.innerText || document.body.innerText || '';
                            if (allText.length > 100) {
                                mainContent = allText.substring(0, 2000) + '...';
                                console.log('Used document text extraction as last resort');
                            }
                        }
                    }
                    
                    return mainContent || 'No content could be extracted from this page';
                }).catch((evalError) => {
                    console.error(`⚠️ Content extraction failed: ${evalError.message}`);
                    return 'Content extraction failed due to page error';
                });

                const extractedData = {
                    title: title,
                    url: url,
                    content: content,
                    pdfs: downloadedPDFs,
                    timestamp: new Date().toISOString()
                };

                console.log(`✅ Successfully extracted content for: ${linkText}`);
                return { success: true, ...extractedData };
                
            } catch (error) {
                lastError = error;
                console.error(`❌ Attempt ${attempt} failed for ${linkText}:`, error.message);
                
                // Enhanced recovery strategy
                if (attempt < maxRetries) {
                    console.log(`⏳ Waiting before retry...`);
                    await new Promise(resolve => setTimeout(resolve, 8000));
                    
                    // Try to recover by going back to base URL
                    try {
                        await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    } catch (recoveryError) {
                        console.log(`⚠️ Recovery navigation failed: ${recoveryError.message}`);
                    }
                }
            }
        }
        
        console.error(`❌ All ${maxRetries} attempts failed for: ${linkText}`);
        return {
            success: false,
            error: lastError?.message || 'Unknown error',
            url: null,
            title: null,
            content: `Error: ${lastError?.message || 'Unknown error'}`,
            pdfs: downloadedPDFs
        };
    }

    async saveLinkContent(linkName, linkData) {
        const safeFilename = linkName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
        const filename = `${safeFilename}.txt`;
        const filepath = path.join(this.outputDir, filename);
        
        let content = `=== ${linkName.toUpperCase()} ===\n\n`;
        content += `Extracted from: ${linkData.url || 'N/A'}\n`;
        content += `Page Title: ${linkData.title || 'N/A'}\n`;
        content += `Extraction Time: ${linkData.timestamp || new Date().toISOString()}\n`;
        content += `\n${'='.repeat(50)}\n\n`;
        
        if (linkData.success && linkData.content) {
            content += linkData.content;
        } else {
            content += `Failed to extract content: ${linkData.content || 'Unknown error'}`;
        }
        
        try {
            await writeFile(filepath, content, 'utf8');
            console.log(`✓ Saved ${linkName} content to: ${filepath}`);
            return { success: true, filepath, contentLength: content.length };
        } catch (error) {
            console.error(`✗ Failed to save ${linkName} content:`, error.message);
            return { success: false, error: error.message };
        }
    }

    async extractAllFooterLinks() {
        try {
            const results = [];
            
            for (const [sectionName, links] of Object.entries(this.footerLinks)) {
                console.log(`\n🔍 Processing ${sectionName.toUpperCase()} section links...`);
                
                for (const linkText of links) {
                    console.log(`\n📄 Extracting content for: ${linkText}`);
                    
                    const linkData = await this.clickAndExtractContent(linkText);
                    const saveResult = await this.saveLinkContent(linkText, linkData);
                    
                    results.push({
                        section: sectionName,
                        linkName: linkText,
                        extractionSuccess: linkData.success,
                        saveSuccess: saveResult.success,
                        filepath: saveResult.filepath,
                        contentLength: saveResult.contentLength,
                        url: linkData.url
                    });
                    
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
            
            return results;
        } catch (error) {
            console.error('Error extracting footer links:', error);
            throw error;
        }
    }

    async generateSummaryReport(footerResults, pdfResults, helpCenterResults) {
        const reportPath = path.join(this.outputDir, 'comprehensive_extraction_summary.txt');
        let report = `JioPay Business - Comprehensive Data Extraction Summary\n`;
        report += `Generated: ${new Date().toISOString()}\n`;
        report += `Source URL: ${this.baseUrl}\n\n`;

        // Footer Links Summary
        report += `=== FOOTER LINKS EXTRACTION ===\n`;
        const totalFooterLinks = footerResults.length;
        const successfulFooterExtractions = footerResults.filter(r => r.extractionSuccess).length;
        const successfulFooterSaves = footerResults.filter(r => r.saveSuccess).length;
        
        report += `Total Links Processed: ${totalFooterLinks}\n`;
        report += `Successful Extractions: ${successfulFooterExtractions}/${totalFooterLinks}\n`;
        report += `Successful File Saves: ${successfulFooterSaves}/${totalFooterLinks}\n`;
        report += `Success Rate: ${((successfulFooterExtractions / totalFooterLinks) * 100).toFixed(1)}%\n\n`;

        // PDF Downloads Summary
        report += `=== PDF DOWNLOADS ===\n`;
        report += `Download Success: ${pdfResults.success ? 'Yes' : 'No'}\n`;
        report += `Total PDFs Downloaded: ${pdfResults.downloadCount || 0}\n`;
        if (pdfResults.files && pdfResults.files.length > 0) {
            report += `Downloaded Files:\n`;
            pdfResults.files.forEach(file => {
                report += `  - ${file}\n`;
            });
        }
        report += `\n`;

        // Help Center Summary
        report += `=== HELP CENTER EXTRACTION ===\n`;
        report += `Extraction Success: ${helpCenterResults.success ? 'Yes' : 'No'}\n`;
        report += `Total Q&A Pairs: ${helpCenterResults.totalQAPairs || 0}\n\n`;

        // Overall Statistics
        report += `=== OVERALL STATISTICS ===\n`;
        const totalOperations = 3; // Footer, PDF, Help Center
        let successfulOperations = 0;
        if (successfulFooterExtractions > 0) successfulOperations++;
        if (pdfResults.success) successfulOperations++;
        if (helpCenterResults.success) successfulOperations++;
        
        report += `Total Extraction Operations: ${totalOperations}\n`;
        report += `Successful Operations: ${successfulOperations}/${totalOperations}\n`;
        report += `Overall Success Rate: ${((successfulOperations / totalOperations) * 100).toFixed(1)}%\n`;

        await writeFile(reportPath, report, 'utf8');
        console.log(`\n📊 Comprehensive summary report saved to: ${reportPath}`);
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            console.log('Browser closed.');
        }
    }
}

async function main() {
    const scraper = new JioPayBusinessScraper();
    
    try {
        console.log('🚀 Starting enhanced JioPay Business content extraction with PDF downloads...');
        await scraper.initialize();
        
        // Extract all footer links (now with PDF detection)
        console.log('📄 Extracting footer links and detecting PDFs...');
        const footerResults = await scraper.extractAllFooterLinks();
        
        // Extract Investor Relations PDFs (existing functionality)
        console.log('💼 Extracting Investor Relations PDFs...');
        const pdfResults = await scraper.downloadInvestorPDFs();
        
        // Extract Help Center Q&A
        console.log('❓ Extracting Help Center Q&A...');
        const helpCenterResults = await scraper.extractHelpCenter();
        
        // Generate comprehensive summary
        await scraper.generateSummaryReport(footerResults, pdfResults, helpCenterResults);
        
        console.log('✅ Enhanced extraction completed successfully!');
        console.log(`📁 Content saved to: ${scraper.outputDir}`);
        console.log(`📄 PDFs saved to: ${scraper.pdfDir}`);
        
    } catch (error) {
        console.error('❌ Enhanced extraction failed:', error);
    } finally {
        await scraper.close();
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}

process.on('SIGINT', async () => {
    console.log('\n🛑 Received interrupt signal. Cleaning up...');
    process.exit(0);
});

module.exports = JioPayBusinessScraper;