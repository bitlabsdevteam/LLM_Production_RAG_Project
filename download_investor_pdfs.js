const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

async function downloadFile(url, filepath) {
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

async function downloadInvestorPDFs() {
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor'
        ]
    });

    const page = await browser.newPage();
    
    try {
        console.log('Navigating to Investor Relations page...');
        await page.goto('https://jiopay.com/business/investor-relation', {
            waitUntil: 'networkidle0',
            timeout: 30000
        });

        // Wait for page to load completely
        await page.waitForTimeout(3000);

        console.log('Searching for PDF links...');
        
        // Look for PDF links using various selectors
        const pdfLinks = await page.evaluate(() => {
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
        const downloadDir = '/Users/davidbong/Documents/VizuaraLabs_LLMHandsOn/RAG_Assigment/pdf/';
        if (!fs.existsSync(downloadDir)) {
            fs.mkdirSync(downloadDir, { recursive: true });
            console.log(`Created directory: ${downloadDir}`);
        }

        // Download each PDF
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
                const filepath = path.join(downloadDir, filename);
                
                console.log(`Downloading: ${link.text}`);
                console.log(`URL: ${downloadUrl}`);
                console.log(`Saving to: ${filepath}`);
                
                await downloadFile(downloadUrl, filepath);
                console.log(`✓ Downloaded: ${filename}`);
                
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
                    const element = await page.$x(`//text()[contains(., '${docName}')]/parent::*`);
                    if (element.length > 0) {
                        console.log(`Found element for: ${docName}`);
                        
                        // Set up download behavior
                        await page._client.send('Page.setDownloadBehavior', {
                            behavior: 'allow',
                            downloadPath: downloadDir
                        });
                        
                        await element[0].click();
                        await page.waitForTimeout(3000);
                        
                        console.log(`✓ Clicked on: ${docName}`);
                    } else {
                        console.log(`✗ Could not find element for: ${docName}`);
                    }
                } catch (error) {
                    console.log(`✗ Error clicking ${docName}: ${error.message}`);
                }
            }
        }

    } catch (error) {
        console.error('Error during PDF extraction:', error);
    } finally {
        await browser.close();
    }

    console.log('\n=== PDF Download Summary ===');
    
    // List downloaded files
    const downloadDir = '/Users/davidbong/Documents/VizuaraLabs_LLMHandsOn/RAG_Assigment/pdf/';
    if (fs.existsSync(downloadDir)) {
        const files = fs.readdirSync(downloadDir).filter(file => file.endsWith('.pdf'));
        console.log(`Downloaded ${files.length} PDF files:`);
        files.forEach(file => {
            const filepath = path.join(downloadDir, file);
            const stats = fs.statSync(filepath);
            console.log(`- ${file} (${Math.round(stats.size / 1024)} KB)`);
        });
    } else {
        console.log('No PDF files downloaded.');
    }
}

// Run the script
downloadInvestorPDFs().catch(console.error);