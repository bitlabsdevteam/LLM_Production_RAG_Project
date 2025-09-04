const puppeteer = require('puppeteer');
const { writeFile, mkdir } = require('fs').promises;
const path = require('path');

class JioPayBusinessScraper {
    constructor() {
        this.browser = null;
        this.page = null;
        this.baseUrl = 'https://jiopay.com/business';
        this.outputDir = './extracted_content';
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
        console.log('Initializing Puppeteer browser...');
        this.browser = await puppeteer.launch({
            headless: false, // Set to true for production
            defaultViewport: { width: 1920, height: 1080 },
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        this.page = await this.browser.newPage();
        
        // Set user agent to avoid blocking
        await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Create output directory if it doesn't exist
        try {
            await mkdir(this.outputDir, { recursive: true });
            console.log(`Output directory created: ${this.outputDir}`);
        } catch (error) {
            console.log('Output directory already exists or error creating:', error.message);
        }
    }

    async clickAndExtractContent(linkText) {
        console.log(`Attempting to click on: ${linkText}`);
        
        try {
            // Navigate back to main page first
            await this.page.goto(this.baseUrl, { waitUntil: 'networkidle2', timeout: 60000 });
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Scroll to bottom to ensure footer is visible
            await this.page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
            });
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            let linkElement = null;
            
            // Strategy 1: Modern Puppeteer text selector (v19.7.1+)
            try {
                linkElement = await this.page.waitForSelector(`::-p-text(${linkText})`, { timeout: 5000 });
                console.log(`✓ Found element using ::-p-text selector`);
            } catch (e) {
                console.log(`Could not find with ::-p-text selector`);
            }
            
            // Strategy 2: Locator API with text filter (v21.0.0+)
            if (!linkElement) {
                try {
                    const locator = this.page.locator('a').filter(el => 
                        el.textContent && el.textContent.trim() === linkText
                    );
                    linkElement = await locator.waitHandle({ timeout: 5000 });
                    console.log(`✓ Found element using locator filter`);
                } catch (e) {
                    console.log(`Could not find with locator filter`);
                }
            }
            
            // Strategy 3: XPath with exact text match
            if (!linkElement) {
                try {
                    const xpath = `//a[normalize-space(text())="${linkText}"]`;
                    const elements = await this.page.$x(xpath);
                    if (elements.length > 0) {
                        linkElement = elements[0];
                        console.log(`✓ Found element using XPath exact match`);
                    }
                } catch (e) {
                    console.log(`Could not find with XPath exact match`);
                }
            }
            
            // Strategy 4: XPath with contains text
            if (!linkElement) {
                try {
                    const xpath = `//a[contains(normalize-space(text()), "${linkText}")]`;
                    const elements = await this.page.$x(xpath);
                    if (elements.length > 0) {
                        linkElement = elements[0];
                        console.log(`✓ Found element using XPath contains`);
                    }
                } catch (e) {
                    console.log(`Could not find with XPath contains`);
                }
            }
            
            // Strategy 5: Evaluate and find by text content
            if (!linkElement) {
                try {
                    linkElement = await this.page.evaluateHandle((text) => {
                        const links = Array.from(document.querySelectorAll('a'));
                        return links.find(link => 
                            link.textContent && 
                            link.textContent.trim() === text
                        );
                    }, linkText);
                    
                    if (linkElement && await linkElement.evaluate(el => el !== null)) {
                        console.log(`✓ Found element using evaluateHandle`);
                    } else {
                        linkElement = null;
                    }
                } catch (e) {
                    console.log(`Could not find with evaluateHandle`);
                    linkElement = null;
                }
            }
            
            if (!linkElement) {
                console.log(`⚠️  Could not find clickable element for: ${linkText}`);
                return { success: false, content: `Link not found: ${linkText}` };
            }
            
            // Get the href before clicking
            const href = await linkElement.evaluate(el => el.href);
            console.log(`Found link with href: ${href}`);
            
            // Click the link and wait for navigation
            try {
                await Promise.all([
                    this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
                    linkElement.click()
                ]);
            } catch (navError) {
                // If navigation fails, try direct navigation to href
                if (href && href !== 'javascript:void(0)' && href !== '#') {
                    console.log(`Navigation failed, trying direct goto: ${href}`);
                    await this.page.goto(href, { waitUntil: 'networkidle2' });
                } else {
                    throw navError;
                }
            }
            
            // Extract content from the new page
            const url = this.page.url();
            const title = await this.page.title();
            
            // Extract main content
            const content = await this.page.evaluate(() => {
                // Remove script and style elements
                const scripts = document.querySelectorAll('script, style, noscript');
                scripts.forEach(el => el.remove());
                
                // Get main content areas
                const contentSelectors = [
                    'main',
                    '[role="main"]',
                    '.content',
                    '.main-content',
                    'article',
                    '.article',
                    '.container',
                    'body'
                ];
                
                let mainContent = '';
                for (const selector of contentSelectors) {
                    const element = document.querySelector(selector);
                    if (element) {
                        mainContent = element.innerText.trim();
                        if (mainContent.length > 100) break;
                    }
                }
                
                return mainContent || document.body.innerText.trim();
            });
            
            const extractedData = {
                title: title,
                url: url,
                content: content,
                timestamp: new Date().toISOString()
            };
            
            console.log(`✓ Successfully extracted content for: ${linkText}`);
            return { success: true, ...extractedData };
            
        } catch (error) {
            console.error(`✗ Error extracting content for ${linkText}:`, error.message);
            return {
                success: false,
                error: error.message,
                url: null,
                title: null,
                content: `Error: ${error.message}`
            };
        }
    }

    async saveLinkContent(linkName, linkData) {
        // Create a safe filename from the link name
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
            
            // Process all footer links from all sections
            for (const [sectionName, links] of Object.entries(this.footerLinks)) {
                console.log(`\n🔍 Processing ${sectionName.toUpperCase()} section links...`);
                
                for (const linkText of links) {
                    console.log(`\n📄 Extracting content for: ${linkText}`);
                    
                    // Extract content by clicking on the link
                    const linkData = await this.clickAndExtractContent(linkText);
                    
                    // Save the extracted content
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
                    
                    // Small delay between extractions to be respectful
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
            
            // Generate summary report
            await this.generateSummaryReport(results);
            
            return results;
        } catch (error) {
            console.error('Error extracting footer links:', error);
            throw error;
        }
    }

    async generateSummaryReport(results) {
        const reportPath = path.join(this.outputDir, 'extraction_summary.txt');
        let report = `JioPay Business Page - Footer Links Extraction Summary\n`;
        report += `Generated: ${new Date().toISOString()}\n`;
        report += `Source URL: ${this.baseUrl}\n\n`;
        
        report += `=== EXTRACTION RESULTS ===\n`;
        
        // Group results by section
        const sectionGroups = {};
        results.forEach(result => {
            if (!sectionGroups[result.section]) {
                sectionGroups[result.section] = [];
            }
            sectionGroups[result.section].push(result);
        });
        
        Object.entries(sectionGroups).forEach(([sectionName, sectionResults]) => {
            report += `\n${sectionName.toUpperCase()} Section:\n`;
            sectionResults.forEach(result => {
                report += `  📄 ${result.linkName}:\n`;
                report += `    Extraction: ${result.extractionSuccess ? '✓ Success' : '✗ Failed'}\n`;
                report += `    File Save: ${result.saveSuccess ? '✓ Success' : '✗ Failed'}\n`;
                if (result.saveSuccess) {
                    report += `    File: ${result.filepath}\n`;
                    report += `    Content Length: ${result.contentLength} characters\n`;
                }
                if (result.url) {
                    report += `    URL: ${result.url}\n`;
                }
                report += `\n`;
            });
        });
        
        report += `=== SUMMARY STATISTICS ===\n`;
        const totalLinks = results.length;
        const successfulExtractions = results.filter(r => r.extractionSuccess).length;
        const successfulSaves = results.filter(r => r.saveSuccess).length;
        
        report += `Total Links Processed: ${totalLinks}\n`;
        report += `Successful Extractions: ${successfulExtractions}/${totalLinks}\n`;
        report += `Successful File Saves: ${successfulSaves}/${totalLinks}\n`;
        report += `Success Rate: ${((successfulExtractions / totalLinks) * 100).toFixed(1)}%\n`;
        
        await writeFile(reportPath, report, 'utf8');
        console.log(`\n📊 Summary report saved to: ${reportPath}`);
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
        await scraper.initialize();
        console.log('🚀 Starting extraction of General, Products, and Legal sections...');
        
        const results = await scraper.extractAllFooterLinks();
        
        console.log('\n✅ Extraction completed successfully!');
        console.log(`📁 Check the './extracted_content' directory for results.`);
        
    } catch (error) {
        console.error('❌ Extraction failed:', error);
    } finally {
        await scraper.close();
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT, shutting down gracefully...');
    process.exit(0);
});

module.exports = JioPayBusinessScraper;