/**
 * JioPay Help Centre FAQ Crawler
 * Systematically extracts FAQ content from JioPay Help Centre by navigating through each menu category
 * from top to bottom, ensuring comprehensive coverage of all FAQ items.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const Tesseract = require('tesseract.js');

class JioPayHelpCentreCrawler {
    constructor() {
        this.browser = null;
        this.page = null;
        this.outputDir = './jiopay_extracted_content';
        this.helpCenterUrl = 'https://jiopay.com/business/help-center';
        this.extractedData = {};
        
        // Ensure output directory exists
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    async init() {
        console.log('🚀 Initializing JioPay Help Centre Crawler...');
        this.browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        });
        
        this.page = await this.browser.newPage();
        await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await this.page.setViewport({ width: 1920, height: 1080 });
        
        // Set longer timeouts
        this.page.setDefaultTimeout(30000);
        this.page.setDefaultNavigationTimeout(30000);
        
        console.log('✅ Browser initialized successfully');
    }

    async wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async saveJSON(data, filename) {
        const filePath = path.join(this.outputDir, filename);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        console.log(`💾 Saved: ${filename}`);
    }

    async scrollToElement(element) {
        try {
            await element.evaluate(el => {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
            await this.wait(1000);
            return true;
        } catch (e) {
            console.log(`⚠️  Error scrolling to element: ${e.message}`);
            return false;
        }
    }

    async clickExpandArrows() {
        try {
            console.log('🔍 Looking for expand arrows...');
            
            // Find and click expand arrows/buttons
            const arrowsClicked = await this.page.evaluate(() => {
                const arrowSelectors = [
                    'button[aria-expanded="false"]',
                    '[class*="arrow"]',
                    '[class*="expand"]',
                    '[class*="chevron"]',
                    'button[class*="css-"]',
                    'div[role="button"]',
                    'span[class*="icon"]',
                    '[data-testid*="expand"]',
                    '[data-testid*="arrow"]'
                ];
                
                let clickedCount = 0;
                
                arrowSelectors.forEach(selector => {
                    try {
                        const elements = document.querySelectorAll(selector);
                        elements.forEach(element => {
                            // Check if element is visible and clickable
                            if (element.offsetParent !== null && 
                                element.getBoundingClientRect().width > 0) {
                                
                                try {
                                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    element.click();
                                    clickedCount++;
                                } catch (e) {
                                    // Try JavaScript click
                                    element.dispatchEvent(new MouseEvent('click', {
                                        bubbles: true,
                                        cancelable: true,
                                        view: window
                                    }));
                                    clickedCount++;
                                }
                            }
                        });
                    } catch (e) {
                        // Continue with next selector
                    }
                });
                
                return clickedCount;
            });
            
            if (arrowsClicked > 0) {
                console.log(`✅ Clicked ${arrowsClicked} expand arrows`);
                await this.wait(2000); // Wait for expansions
            } else {
                console.log('ℹ️  No expand arrows found');
            }
            
            return arrowsClicked;
            
        } catch (e) {
            console.log(`⚠️  Error clicking expand arrows: ${e.message}`);
            return 0;
        }
    }

    async extractTextFromImages(questionContext) {
        try {
            console.log('🖼️  Looking for images to extract text from...');
            
            // Find images in the expanded content area
            const images = await this.page.evaluate((question) => {
                const imageElements = document.querySelectorAll('img');
                const relevantImages = [];
                
                imageElements.forEach(img => {
                    // Check if image is visible and has content
                    if (img.offsetParent !== null && 
                        img.src && 
                        img.getBoundingClientRect().width > 50 &&
                        img.getBoundingClientRect().height > 50) {
                        
                        // Check if image is near the question context
                        const imgRect = img.getBoundingClientRect();
                        const questionElements = document.querySelectorAll('*');
                        
                        for (const element of questionElements) {
                            if (element.textContent?.includes(question)) {
                                const elemRect = element.getBoundingClientRect();
                                const distance = Math.abs(imgRect.top - elemRect.top);
                                
                                // If image is within 500px of the question
                                if (distance < 500) {
                                    relevantImages.push({
                                        src: img.src,
                                        alt: img.alt || '',
                                        width: imgRect.width,
                                        height: imgRect.height
                                    });
                                    break;
                                }
                            }
                        }
                    }
                });
                
                return relevantImages;
            }, questionContext);
            
            if (images.length === 0) {
                console.log('ℹ️  No relevant images found for OCR');
                return null;
            }
            
            console.log(`🔍 Found ${images.length} images for OCR processing`);
            
            let extractedText = '';
            
            // Process each image with Tesseract OCR
            for (let i = 0; i < images.length; i++) {
                const image = images[i];
                console.log(`📖 Processing image ${i + 1}/${images.length} with OCR...`);
                
                try {
                    // Take screenshot of the specific image area
                    const imageBuffer = await this.page.screenshot({
                        clip: {
                            x: 0,
                            y: 0,
                            width: image.width,
                            height: image.height
                        }
                    });
                    
                    // Use Tesseract to extract text
                    const { data: { text } } = await Tesseract.recognize(imageBuffer, 'eng', {
                        logger: m => {
                            if (m.status === 'recognizing text') {
                                console.log(`📝 OCR Progress: ${Math.round(m.progress * 100)}%`);
                            }
                        }
                    });
                    
                    if (text && text.trim().length > 10) {
                        extractedText += text.trim() + '\n\n';
                        console.log(`✅ Extracted ${text.trim().length} characters from image ${i + 1}`);
                    }
                    
                } catch (ocrError) {
                    console.log(`⚠️  OCR failed for image ${i + 1}: ${ocrError.message}`);
                }
            }
            
            if (extractedText.trim()) {
                console.log(`🎉 Successfully extracted text from images: ${extractedText.length} characters`);
                return `[OCR Extracted Content]\n${extractedText.trim()}`;
            } else {
                console.log('ℹ️  No text could be extracted from images');
                return null;
            }
            
        } catch (e) {
            console.log(`❌ Error in OCR extraction: ${e.message}`);
            return null;
        }
    }

    async findFAQMenuCategories() {
        console.log('🔍 Looking for FAQ menu categories...');
        
        // Wait for page to load completely
        await this.wait(5000);
        
        // Find FAQ category buttons/menus
        const categories = await this.page.evaluate(() => {
            const categorySelectors = [
                'button[class*="css-g5y9jx"]',
                '.css-g5y9jx',
                'button',
                '[role="button"]',
                'div[class*="css-g5y9jx"]',
                'div[class*="r-1i6wzkk"]'
            ];
            
            const foundCategories = [];
            
            categorySelectors.forEach(selector => {
                try {
                    const elements = document.querySelectorAll(selector);
                    elements.forEach((element, index) => {
                        const text = element.textContent?.trim();
                        
                        // Check if this is a FAQ category based on known categories
                        const faqCategories = [
                            'JioPay Business App',
                            'JioPay Business Dashboard', 
                            'Collect link',
                            'User Management',
                            'Repeat',
                            'Campaign',
                            'Settlement',
                            'Refunds',
                            'Notifications',
                            'Voicebox',
                            'DQR',
                            'Partner program',
                            'P2PM'
                        ];
                        
                        if (text && faqCategories.some(category => 
                            text.toLowerCase().includes(category.toLowerCase())
                        )) {
                            foundCategories.push({
                                name: text,
                                selector: selector,
                                index: index,
                                yPosition: element.getBoundingClientRect().y
                            });
                        }
                    });
                } catch (e) {
                    // Continue with next selector
                }
            });
            
            // Remove duplicates and sort by Y position (top to bottom)
            const uniqueCategories = [];
            const seenNames = new Set();
            
            foundCategories.forEach(category => {
                if (!seenNames.has(category.name)) {
                    uniqueCategories.push(category);
                    seenNames.add(category.name);
                }
            });
            
            // Sort from top to bottom
            uniqueCategories.sort((a, b) => a.yPosition - b.yPosition);
            
            return uniqueCategories;
        });
        
        console.log(`✅ Found ${categories.length} unique FAQ categories`);
        categories.forEach(cat => console.log(`📋 Category: ${cat.name}`));
        
        return categories;
    }

    async clickCategoryAndExpandFAQs(category) {
        const categoryName = category.name;
        console.log(`\n🎯 Processing category: ${categoryName}`);
        
        try {
            // Click the category button
            const clicked = await this.page.evaluate((cat) => {
                const elements = document.querySelectorAll(cat.selector);
                const element = elements[cat.index];
                
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    
                    // Try multiple click methods
                    try {
                        element.click();
                        return true;
                    } catch (e) {
                        // Try JavaScript click
                        element.dispatchEvent(new MouseEvent('click', {
                            bubbles: true,
                            cancelable: true,
                            view: window
                        }));
                        return true;
                    }
                }
                return false;
            }, category);
            
            if (clicked) {
                console.log(`✅ Clicked category: ${categoryName}`);
                await this.wait(3000);
                
                // Now find and expand all FAQ items in this category from top to bottom
                const faqs = await this.findAndExpandFAQsInCategory(categoryName);
                return faqs;
            } else {
                console.log(`❌ Failed to click category: ${categoryName}`);
                return [];
            }
            
        } catch (e) {
            console.log(`❌ Error processing category ${categoryName}: ${e.message}`);
            return [];
        }
    }

    async findAndExpandFAQsInCategory(categoryName) {
        console.log(`📝 Finding FAQ questions in category: ${categoryName}`);
        
        // Wait for content to load
        await this.wait(3000);
        
        // Find all FAQ question elements
        const faqElements = await this.page.evaluate(() => {
            const questionSelectors = ['div', 'button', '[role="button"]', 'span', 'p'];
            const faqItems = [];
            
            questionSelectors.forEach(selector => {
                try {
                    const elements = document.querySelectorAll(selector);
                    elements.forEach(element => {
                        const text = element.textContent?.trim();
                        
                        // Check if this looks like a FAQ question
                        if (text && 
                            text.includes('?') && 
                            text.length > 10 && 
                            text.length < 300 &&
                            element.offsetParent !== null) { // visible element
                            
                            const rect = element.getBoundingClientRect();
                            faqItems.push({
                                question: text,
                                yPosition: rect.y,
                                selector: selector,
                                className: element.className,
                                tagName: element.tagName
                            });
                        }
                    });
                } catch (e) {
                    // Continue with next selector
                }
            });
            
            // Sort from top to bottom and remove duplicates
            const uniqueFAQs = [];
            const seenQuestions = new Set();
            
            faqItems.sort((a, b) => a.yPosition - b.yPosition);
            
            faqItems.forEach(item => {
                if (!seenQuestions.has(item.question)) {
                    uniqueFAQs.push(item);
                    seenQuestions.add(item.question);
                }
            });
            
            return uniqueFAQs;
        });
        
        console.log(`📋 Found ${faqElements.length} FAQ questions in ${categoryName}`);
        
        // Process each FAQ from top to bottom
        const extractedFAQs = [];
        
        for (let i = 0; i < faqElements.length; i++) {
            const faqItem = faqElements[i];
            console.log(`🔄 Processing FAQ ${i+1}/${faqElements.length}: ${faqItem.question.substring(0, 50)}...`);
            
            try {
                // Click the FAQ question to expand it
                const expanded = await this.page.evaluate((question) => {
                    // Find the element with this exact question text
                    const allElements = document.querySelectorAll('*');
                    for (const element of allElements) {
                        if (element.textContent?.trim() === question) {
                            try {
                                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                element.click();
                                return true;
                            } catch (e) {
                                // Try JavaScript click
                                element.dispatchEvent(new MouseEvent('click', {
                                    bubbles: true,
                                    cancelable: true,
                                    view: window
                                }));
                                return true;
                            }
                        }
                    }
                    return false;
                }, faqItem.question);
                
                if (expanded) {
                    // Wait for answer to expand
                    await this.wait(2000);
                    
                    // Extract the answer
                    const answer = await this.extractAnswerForQuestion(faqItem.question);
                    
                    extractedFAQs.push({
                        question: faqItem.question,
                        answer: answer,
                        category: categoryName,
                        position: i + 1
                    });
                    
                    console.log(`✅ Extracted FAQ ${i+1}: ${answer.length} characters`);
                } else {
                    console.log(`⚠️  Could not expand FAQ ${i+1}`);
                    extractedFAQs.push({
                        question: faqItem.question,
                        answer: 'Could not extract answer - element not expandable',
                        category: categoryName,
                        position: i + 1
                    });
                }
                
            } catch (e) {
                console.log(`⚠️  Error processing FAQ ${i+1}: ${e.message}`);
                extractedFAQs.push({
                    question: faqItem.question,
                    answer: `Error extracting answer: ${e.message}`,
                    category: categoryName,
                    position: i + 1
                });
            }
        }
        
        return extractedFAQs;
    }

    async extractAnswerForQuestion(question) {
        try {
            // Wait a moment for content to expand
            await this.wait(2000);
            
            // First try to find and click any expand arrows
            await this.clickExpandArrows();
            
            // Wait for expansion
            await this.wait(1500);
            
            // Look for answer content with various strategies
            const answer = await this.page.evaluate((questionText) => {
                const answerSelectors = [
                    '[class*="answer"]',
                    '[class*="content"]', 
                    '[class*="expanded"]',
                    '[aria-expanded="true"]',
                    'div[style*="background"]',
                    'div[class*="css-"]',
                    '.faq-answer',
                    '.accordion-content',
                    '[role="region"]'
                ];
                
                let bestAnswer = '';
                
                // Strategy 1: Look for answer elements
                answerSelectors.forEach(selector => {
                    try {
                        const elements = document.querySelectorAll(selector);
                        elements.forEach(element => {
                            const text = element.textContent?.trim();
                            
                            // Check if this looks like an answer
                            if (text && 
                                text.length > 20 && 
                                text !== questionText &&
                                !text.includes('?') &&
                                element.offsetParent !== null) {
                                
                                if (text.length > bestAnswer.length) {
                                    bestAnswer = text;
                                }
                            }
                        });
                    } catch (e) {
                        // Continue with next selector
                    }
                });
                
                // Strategy 2: Look for content near the question
                if (!bestAnswer) {
                    const allElements = document.querySelectorAll('*');
                    for (const element of allElements) {
                        if (element.textContent?.includes(questionText)) {
                            // Look for sibling or child elements with substantial content
                            const siblings = [element.nextElementSibling, element.parentElement?.nextElementSibling];
                            const children = Array.from(element.children);
                            
                            [...siblings, ...children].forEach(candidate => {
                                if (candidate) {
                                    const candidateText = candidate.textContent?.trim();
                                    if (candidateText && 
                                        candidateText.length > 30 && 
                                        candidateText !== questionText &&
                                        !candidateText.includes(questionText) &&
                                        candidateText.length > bestAnswer.length) {
                                        bestAnswer = candidateText;
                                    }
                                }
                            });
                            break;
                        }
                    }
                }
                
                return bestAnswer || 'Unable to extract answer';
            }, question);
            
            // If no text answer found, try OCR on images
            if (!answer || answer === 'Unable to extract answer') {
                const ocrAnswer = await this.extractTextFromImages(question);
                if (ocrAnswer) {
                    return ocrAnswer;
                }
            }
            
            return answer;
            
        } catch (e) {
            return `Error extracting answer: ${e.message}`;
        }
    }

    async extractCoralBackgroundText() {
        try {
            console.log('🎨 Looking for coral/orange background text content (including gradients, shadows, and advanced styling)...');
            
            const coralTextContent = await this.page.evaluate(() => {
                const results = [];
                const allElements = document.querySelectorAll('*');
                
                // Helper function to check if a color is orange/coral-like
                const isOrangeCoralColor = (colorStr) => {
                    if (!colorStr || colorStr === 'transparent' || colorStr === 'none') return false;
                    
                    // Direct color name matches
                    if (colorStr.includes('coral') || colorStr.includes('orange') || 
                        colorStr.includes('tomato') || colorStr.includes('darkorange') ||
                        colorStr.includes('orangered')) return true;
                    
                    // RGB/RGBA pattern matching for orange/coral range
                    const rgbMatch = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                    if (rgbMatch) {
                        const [, r, g, b] = rgbMatch.map(Number);
                        // Orange/coral range: high red (200-255), medium green (50-180), low blue (0-100)
                        return r >= 200 && r <= 255 && g >= 50 && g <= 180 && b >= 0 && b <= 100;
                    }
                    
                    // Hex color matching
                    const hexMatch = colorStr.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})/);
                    if (hexMatch) {
                        let hex = hexMatch[1];
                        if (hex.length === 3) {
                            hex = hex.split('').map(c => c + c).join('');
                        }
                        const r = parseInt(hex.substr(0, 2), 16);
                        const g = parseInt(hex.substr(2, 2), 16);
                        const b = parseInt(hex.substr(4, 2), 16);
                        return r >= 200 && r <= 255 && g >= 50 && g <= 180 && b >= 0 && b <= 100;
                    }
                    
                    return false;
                };
                
                allElements.forEach((element, index) => {
                    const computedStyle = window.getComputedStyle(element);
                    const backgroundColor = computedStyle.backgroundColor;
                    const borderColor = computedStyle.borderColor;
                    const backgroundImage = computedStyle.backgroundImage;
                    const boxShadow = computedStyle.boxShadow;
                    const textShadow = computedStyle.textShadow;
                    const borderImage = computedStyle.borderImage;
                    
                    // Check for coral/orange in various CSS properties
                    const isCoralBackground = isOrangeCoralColor(backgroundColor);
                    const isCoralBorder = isOrangeCoralColor(borderColor);
                    
                    // Check gradients in background-image
                    const hasCoralGradient = backgroundImage && backgroundImage !== 'none' && (
                        backgroundImage.includes('coral') ||
                        backgroundImage.includes('orange') ||
                        backgroundImage.includes('tomato') ||
                        // Check for RGB values in gradients
                        /rgba?\(25[0-5],\s*[5-9][0-9]|1[0-7][0-9],\s*[0-9]{1,2}/.test(backgroundImage)
                    );
                    
                    // Check box-shadow for orange/coral colors
                    const hasCoralShadow = boxShadow && boxShadow !== 'none' && isOrangeCoralColor(boxShadow);
                    
                    // Check text-shadow for orange/coral colors
                    const hasCoralTextShadow = textShadow && textShadow !== 'none' && isOrangeCoralColor(textShadow);
                    
                    // Check border-image for orange/coral
                    const hasCoralBorderImage = borderImage && borderImage !== 'none' && isOrangeCoralColor(borderImage);
                    
                    if (isCoralBackground || isCoralBorder || hasCoralGradient || hasCoralShadow || hasCoralTextShadow || hasCoralBorderImage) {
                        const rect = element.getBoundingClientRect();
                        const text = element.textContent?.trim();
                        const hasImages = element.querySelectorAll('img').length > 0;
                        const tagName = element.tagName.toLowerCase();
                        
                        // Only include visible elements with meaningful content
                        if (rect.width > 0 && rect.height > 0 && 
                            element.offsetParent !== null && 
                            text && text.length > 10) {
                            
                            results.push({
                                index,
                                tagName,
                                text: text,
                                textLength: text.length,
                                hasImages,
                                imageCount: element.querySelectorAll('img').length,
                                backgroundColor,
                                borderColor,
                                backgroundImage,
                                boxShadow,
                                textShadow,
                                borderImage,
                                detectionMethod: {
                                    background: isCoralBackground,
                                    border: isCoralBorder,
                                    gradient: hasCoralGradient,
                                    boxShadow: hasCoralShadow,
                                    textShadow: hasCoralTextShadow,
                                    borderImage: hasCoralBorderImage
                                },
                                width: Math.round(rect.width),
                                height: Math.round(rect.height),
                                x: Math.round(rect.x),
                                y: Math.round(rect.y),
                                className: element.className || '',
                                id: element.id || '',
                                isVisible: true,
                                extractedAt: new Date().toISOString()
                            });
                        }
                    }
                });
                
                // Sort by position (top to bottom, left to right)
                results.sort((a, b) => {
                    if (Math.abs(a.y - b.y) < 10) {
                        return a.x - b.x; // Same row, sort by x
                    }
                    return a.y - b.y; // Different rows, sort by y
                });
                
                return results;
            });
            
            console.log(`🎯 Found ${coralTextContent.length} coral/orange background elements`);
            
            if (coralTextContent.length > 0) {
                // Log details of found elements
                coralTextContent.forEach((element, index) => {
                    console.log(`📋 Coral Element ${index + 1}:`);
                    console.log(`   Tag: ${element.tagName}`);
                    console.log(`   Size: ${element.width}x${element.height}`);
                    console.log(`   Background: ${element.backgroundColor}`);
                    console.log(`   Detection Methods: ${Object.entries(element.detectionMethod).filter(([k,v]) => v).map(([k,v]) => k).join(', ')}`);
                    if (element.backgroundImage && element.backgroundImage !== 'none') {
                        console.log(`   Background Image: ${element.backgroundImage.substring(0, 50)}...`);
                    }
                    if (element.boxShadow && element.boxShadow !== 'none') {
                        console.log(`   Box Shadow: ${element.boxShadow}`);
                    }
                    console.log(`   Text Length: ${element.textLength} characters`);
                    console.log(`   Preview: "${element.text.substring(0, 100)}${element.text.length > 100 ? '...' : ''}"`);  
                });
                
                // Save coral content to separate file
                const coralData = {
                    title: 'JioPay Help Center - Coral Background Content',
                    url: this.helpCenterUrl,
                    extractedAt: new Date().toISOString(),
                    totalElements: coralTextContent.length,
                    elements: coralTextContent
                };
                
                await this.saveJSON(coralData, 'coral_background_content.json');
                console.log('💾 Coral background content saved to coral_background_content.json');
            }
            
            return coralTextContent;
            
        } catch (error) {
            console.error('❌ Error extracting coral background text:', error.message);
            return [];
        }
    }

    async crawlHelpCentre() {
        try {
            // Initialize browser
            await this.init();
            
            // Navigate to help center
            console.log(`🌐 Navigating to: ${this.helpCenterUrl}`);
            await this.page.goto(this.helpCenterUrl, { waitUntil: 'networkidle2' });
            
            // Wait for page to fully load
            await this.wait(3000);
            
            // Extract coral background content first
            const coralContent = await this.extractCoralBackgroundText();
            
            // Find all FAQ menu categories
            const categories = await this.findFAQMenuCategories();
            
            if (categories.length === 0) {
                console.log('❌ No FAQ categories found!');
                return;
            }
            
            // Process each category from top to bottom
            const allFAQs = [];
            const categoryData = {};
            
            for (let i = 0; i < categories.length; i++) {
                const category = categories[i];
                console.log(`\n🎯 Processing category ${i+1}/${categories.length}: ${category.name}`);
                
                // Extract FAQs from this category
                const categoryFAQs = await this.clickCategoryAndExpandFAQs(category);
                
                // Store category data
                categoryData[category.name] = {
                    categoryName: category.name,
                    faqs: categoryFAQs,
                    totalFAQs: categoryFAQs.length,
                    timestamp: new Date().toISOString()
                };
                
                // Save individual category file
                const filename = `${category.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}.json`;
                await this.saveJSON(categoryData[category.name], filename);
                
                allFAQs.push(...categoryFAQs);
                
                console.log(`✅ Completed category: ${category.name} (${categoryFAQs.length} FAQs)`);
            }
            
            // Save complete help center data
            const completeData = {
                title: 'JioPay Business Help Center - Complete FAQ Data',
                url: this.helpCenterUrl,
                timestamp: new Date().toISOString(),
                totalCategories: categories.length,
                totalFAQs: allFAQs.length,
                categories: categoryData,
                allFAQs: allFAQs
            };
            
            await this.saveJSON(completeData, 'help_center_complete.json');
            
            console.log(`\n🎉 Crawling completed successfully!`);
            console.log(`📊 Total categories processed: ${categories.length}`);
            console.log(`📊 Total FAQs extracted: ${allFAQs.length}`);
            
            return completeData;
            
        } catch (e) {
            console.log(`❌ Error during crawling: ${e.message}`);
            return null;
            
        } finally {
            if (this.browser) {
                console.log('🔄 Closing browser...');
                await this.browser.close();
                console.log('✅ Browser closed');
            }
        }
    }
}

// Main execution function
async function main() {
    const crawler = new JioPayHelpCentreCrawler();
    const result = await crawler.crawlHelpCentre();
    
    if (result) {
        console.log('\n✅ Help Centre crawling completed successfully!');
        console.log(`📁 Output saved to: ${crawler.outputDir}`);
    } else {
        console.log('\n❌ Help Centre crawling failed!');
    }
}

// Run the crawler if this file is executed directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = JioPayHelpCentreCrawler;