import json
import os
import logging
from datetime import datetime
from typing import Dict, Any, List, Set
from firecrawl import Firecrawl
from docling.document_converter import DocumentConverter
from docling.datamodel.base_models import InputFormat
from pathlib import Path
import re
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser
import requests
from bs4 import BeautifulSoup
import hashlib
from PIL import Image
import io

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class FirecrawlLambdaScraper:
    def __init__(self, api_key: str, max_pages: int = 500):
        """Initialize the Firecrawl scraper with API key and comprehensive crawling settings."""
        self.firecrawl = Firecrawl(api_key=api_key)
        self.base_url = "https://www.jiopay.com"
        self.html_folder = "html"
        self.text_folder = "text"
        self.images_folder = "images"  # New images folder
        self.max_pages = max_pages
        
        # URL tracking and management
        self.crawled_urls: Set[str] = set()
        self.failed_urls: Set[str] = set()
        self.downloaded_images: Set[str] = set()  # Track downloaded images
        self.failed_images: Set[str] = set()  # Track failed image downloads
        self.robots_parser = None
        
        # Initialize docling converter
        self.doc_converter = DocumentConverter()
        
        # Create directories if they don't exist
        os.makedirs(self.html_folder, exist_ok=True)
        os.makedirs(self.text_folder, exist_ok=True)
        os.makedirs(self.images_folder, exist_ok=True)  # Create images folder
        
        # Initialize robots.txt compliance
        self._setup_robots_compliance()
    
    def _setup_robots_compliance(self):
        """Setup robots.txt parser for compliance checking."""
        try:
            robots_url = urljoin(self.base_url, '/robots.txt')
            self.robots_parser = RobotFileParser()
            self.robots_parser.set_url(robots_url)
            self.robots_parser.read()
            logger.info(f"Robots.txt loaded from {robots_url}")
        except Exception as e:
            logger.warning(f"Could not load robots.txt: {str(e)}. Proceeding without robots.txt restrictions.")
            self.robots_parser = None
    
    def _is_url_allowed(self, url: str, user_agent: str = '*') -> bool:
        """Check if URL is allowed by robots.txt."""
        if not self.robots_parser:
            return True
        try:
            return self.robots_parser.can_fetch(user_agent, url)
        except Exception as e:
            logger.warning(f"Error checking robots.txt for {url}: {str(e)}")
            return True
    
    def _generate_filename(self, url: str, extension: str) -> str:
        """Generate a proper filename from URL with timestamp."""
        # Extract domain and path for filename
        clean_url = re.sub(r'https?://', '', url)
        clean_url = re.sub(r'[^a-zA-Z0-9_-]', '_', clean_url)
        # Limit filename length to avoid filesystem issues
        if len(clean_url) > 100:
            clean_url = clean_url[:100]
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        return f"{clean_url}_{timestamp}.{extension}"
    
    def _generate_image_filename(self, image_url: str, content_type: str = None) -> str:
        """Generate a unique filename for images based on URL hash and content type."""
        # Create hash of URL for unique filename
        url_hash = hashlib.md5(image_url.encode()).hexdigest()[:12]
        
        # Determine file extension
        if content_type:
            if 'jpeg' in content_type or 'jpg' in content_type:
                ext = 'jpg'
            elif 'png' in content_type:
                ext = 'png'
            elif 'gif' in content_type:
                ext = 'gif'
            elif 'webp' in content_type:
                ext = 'webp'
            elif 'svg' in content_type:
                ext = 'svg'
            else:
                ext = 'jpg'  # Default
        else:
            # Try to get extension from URL
            parsed_url = urlparse(image_url)
            path = parsed_url.path.lower()
            if path.endswith(('.jpg', '.jpeg')):
                ext = 'jpg'
            elif path.endswith('.png'):
                ext = 'png'
            elif path.endswith('.gif'):
                ext = 'gif'
            elif path.endswith('.webp'):
                ext = 'webp'
            elif path.endswith('.svg'):
                ext = 'svg'
            else:
                ext = 'jpg'  # Default
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        return f"img_{url_hash}_{timestamp}.{ext}"
    
    def _is_valid_image_url(self, url: str) -> bool:
        """Check if URL points to a valid image."""
        if not url:
            return False
        
        # Skip data URLs, they're embedded
        if url.startswith('data:'):
            return False
        
        # Skip very small images (likely icons/tracking pixels)
        if any(dim in url.lower() for dim in ['1x1', '1px', 'pixel']):
            return False
        
        # Check for common image extensions
        image_extensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp']
        url_lower = url.lower()
        
        # Check if URL ends with image extension
        if any(url_lower.endswith(ext) for ext in image_extensions):
            return True
        
        # Check if URL contains image-related keywords
        if any(keyword in url_lower for keyword in ['image', 'img', 'photo', 'picture']):
            return True
        
        return False
    
    def extract_image_urls_from_html(self, html_content: str, base_url: str) -> List[str]:
        """Extract all image URLs from HTML content."""
        image_urls = set()
        
        try:
            soup = BeautifulSoup(html_content, 'html.parser')
            
            # Find all img tags
            img_tags = soup.find_all('img')
            
            for img in img_tags:
                # Get src attribute
                src = img.get('src')
                if src and self._is_valid_image_url(src):
                    # Convert relative URLs to absolute
                    if src.startswith('//'):
                        src = 'https:' + src
                    elif src.startswith('/'):
                        src = urljoin(base_url, src)
                    elif not src.startswith(('http://', 'https://')):
                        src = urljoin(base_url, src)
                    
                    image_urls.add(src)
                
                # Also check data-src for lazy-loaded images
                data_src = img.get('data-src')
                if data_src and self._is_valid_image_url(data_src):
                    if data_src.startswith('//'):
                        data_src = 'https:' + data_src
                    elif data_src.startswith('/'):
                        data_src = urljoin(base_url, data_src)
                    elif not data_src.startswith(('http://', 'https://')):
                        data_src = urljoin(base_url, data_src)
                    
                    image_urls.add(data_src)
            
            # Also check for background images in style attributes
            elements_with_style = soup.find_all(attrs={'style': True})
            for element in elements_with_style:
                style = element.get('style', '')
                # Look for background-image URLs
                bg_matches = re.findall(r'background-image:\s*url\(["\']?([^"\')]+)["\']?\)', style)
                for bg_url in bg_matches:
                    if self._is_valid_image_url(bg_url):
                        if bg_url.startswith('//'):
                            bg_url = 'https:' + bg_url
                        elif bg_url.startswith('/'):
                            bg_url = urljoin(base_url, bg_url)
                        elif not bg_url.startswith(('http://', 'https://')):
                            bg_url = urljoin(base_url, bg_url)
                        
                        image_urls.add(bg_url)
            
            logger.info(f"Extracted {len(image_urls)} image URLs from HTML")
            return list(image_urls)
            
        except Exception as e:
            logger.error(f"Error extracting image URLs from HTML: {str(e)}")
            return []
    
    def download_image(self, image_url: str) -> str:
        """Download an image from URL and save it to the images folder."""
        try:
            # Check robots.txt compliance
            if not self._is_url_allowed(image_url):
                logger.warning(f"Image URL {image_url} disallowed by robots.txt")
                self.failed_images.add(image_url)
                return None
            
            # Download the image
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
            
            response = requests.get(image_url, headers=headers, timeout=30, stream=True)
            response.raise_for_status()
            
            # Check if it's actually an image
            content_type = response.headers.get('content-type', '').lower()
            if not content_type.startswith('image/'):
                logger.warning(f"URL {image_url} does not return an image (content-type: {content_type})")
                self.failed_images.add(image_url)
                return None
            
            # Generate filename
            filename = self._generate_image_filename(image_url, content_type)
            filepath = os.path.join(self.images_folder, filename)
            
            # Save the image
            with open(filepath, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            # Verify the image is valid by trying to open it
            try:
                with Image.open(filepath) as img:
                    # Get image info
                    width, height = img.size
                    format_name = img.format
                    
                    # Skip very small images (likely tracking pixels)
                    if width < 10 or height < 10:
                        os.remove(filepath)
                        logger.info(f"Removed tiny image {filename} ({width}x{height})")
                        self.failed_images.add(image_url)
                        return None
                    
                    logger.info(f"Downloaded image: {filename} ({width}x{height}, {format_name})")
                    self.downloaded_images.add(image_url)
                    return filepath
                    
            except Exception as img_error:
                # If we can't open it as an image, remove the file
                if os.path.exists(filepath):
                    os.remove(filepath)
                logger.warning(f"Invalid image file {filename}: {str(img_error)}")
                self.failed_images.add(image_url)
                return None
            
        except requests.exceptions.RequestException as e:
            logger.error(f"Error downloading image {image_url}: {str(e)}")
            self.failed_images.add(image_url)
            return None
        except Exception as e:
            logger.error(f"Unexpected error downloading image {image_url}: {str(e)}")
            self.failed_images.add(image_url)
            return None
    
    def extract_and_download_images(self, html_files: List[str]) -> List[Dict]:
        """Extract and download all images from HTML files."""
        downloaded_images_info = []
        
        try:
            for html_file in html_files:
                logger.info(f"Extracting images from: {html_file}")
                
                # Read HTML content
                with open(html_file, 'r', encoding='utf-8') as f:
                    html_content = f.read()
                
                # Extract image URLs
                image_urls = self.extract_image_urls_from_html(html_content, self.base_url)
                
                # Download each image
                for image_url in image_urls:
                    if image_url not in self.downloaded_images and image_url not in self.failed_images:
                        downloaded_path = self.download_image(image_url)
                        
                        if downloaded_path:
                            downloaded_images_info.append({
                                'source_html': html_file,
                                'image_url': image_url,
                                'local_path': downloaded_path,
                                'filename': os.path.basename(downloaded_path)
                            })
            
            logger.info(f"Image extraction completed. Downloaded: {len(self.downloaded_images)}, Failed: {len(self.failed_images)}")
            return downloaded_images_info
            
        except Exception as e:
            logger.error(f"Error in image extraction process: {str(e)}")
            raise
    
    def crawl_entire_website(self) -> Dict[str, Any]:
        """Crawl the entire JioPay website comprehensively using Firecrawl's advanced crawl functionality."""
        try:
            logger.info(f"Starting comprehensive site crawl of {self.base_url}")
            logger.info(f"Maximum pages to crawl: {self.max_pages}")
            
            # Check robots.txt compliance for base URL
            if not self._is_url_allowed(self.base_url):
                logger.warning(f"Base URL {self.base_url} is disallowed by robots.txt")
            
            # Print debug info
            logger.info("Calling Firecrawl API with parameters: url=%s, limit=%s", self.base_url, self.max_pages)
            
            # Comprehensive crawl configuration for deep site exploration
            crawl_result = self.firecrawl.crawl(
                url=self.base_url,
                limit=self.max_pages,
                scrape_options={
                    'formats': ['markdown', 'html'],
                    'onlyMainContent': False,
                    'includeTags': ['nav', 'menu', 'sidebar', 'footer'],
                    'waitFor': 2000,
                    'screenshot': False
                }
            )
            
            # Handle CrawlJob object response
            if not crawl_result or not hasattr(crawl_result, 'data') or not crawl_result.data:
                raise Exception("No data returned from Firecrawl crawl")
            
            # Track crawled URLs
            for page in crawl_result.data:
                if hasattr(page, 'metadata') and page.metadata and hasattr(page.metadata, 'sourceURL'):
                    self.crawled_urls.add(page.metadata.sourceURL)
            
            logger.info(f"Successfully crawled {len(crawl_result.data)} pages")
            logger.info(f"Crawl status: {crawl_result.status}")
            logger.info(f"Unique URLs crawled: {len(self.crawled_urls)}")
            
            # Log crawl statistics
            if hasattr(crawl_result, 'total'):
                logger.info(f"Total pages discovered: {crawl_result.total}")
            if hasattr(crawl_result, 'completed'):
                logger.info(f"Pages completed: {crawl_result.completed}")
            
            return crawl_result
            
        except Exception as e:
            logger.error(f"Error crawling website: {str(e)}")
            raise
    
    def save_html_files(self, crawl_data: List) -> List[str]:
        """Save HTML content from multiple pages to the html folder with URL validation."""
        saved_files = []
        
        try:
            for i, page_data in enumerate(crawl_data):
                # Handle Document objects from Firecrawl
                if hasattr(page_data, 'metadata') and hasattr(page_data, 'html'):
                    # Document object
                    if page_data.metadata and hasattr(page_data.metadata, 'sourceURL'):
                        page_url = page_data.metadata.sourceURL
                        # Validate URL compliance
                        if not self._is_url_allowed(page_url):
                            logger.warning(f"Skipping {page_url} - disallowed by robots.txt")
                            self.failed_urls.add(page_url)
                            continue
                    else:
                        page_url = f"{self.base_url}/page_{i}"
                    html_content = page_data.html if hasattr(page_data, 'html') else ''
                elif isinstance(page_data, dict):
                    # Dictionary object (fallback)
                    page_url = page_data.get('metadata', {}).get('sourceURL', f"{self.base_url}/page_{i}")
                    html_content = page_data.get('html', '')
                else:
                    logger.warning(f"Unknown page data type: {type(page_data)}")
                    continue
                
                if not html_content:
                    logger.warning(f"No HTML content for page: {page_url}")
                    self.failed_urls.add(page_url)
                    continue
                
                # Generate filename based on URL
                filename = self._generate_filename(page_url, "html")
                filepath = os.path.join(self.html_folder, filename)
                
                # Save HTML file
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(html_content)
                
                saved_files.append(filepath)
                logger.info(f"HTML file saved: {filepath}")
            
            return saved_files
            
        except Exception as e:
            logger.error(f"Error saving HTML files: {str(e)}")
            raise
    
    def extract_text_with_docling(self, html_file_path: str) -> str:
        """Extract text content from HTML file using docling."""
        try:
            logger.info(f"Processing HTML file with docling: {html_file_path}")
            
            # Convert HTML file to document using docling
            result = self.doc_converter.convert(html_file_path, input_format=InputFormat.HTML)
            
            # Extract text content from the document
            if result and hasattr(result, 'document') and result.document:
                # Get the markdown content which contains the extracted text
                text_content = result.document.export_to_markdown()
                logger.info(f"Successfully extracted text using docling: {len(text_content)} characters")
                return text_content
            else:
                logger.warning(f"No document content extracted from {html_file_path}")
                return ""
                
        except Exception as e:
            logger.error(f"Error extracting text with docling from {html_file_path}: {str(e)}")
            return ""
    
    def save_text_file(self, text_content: str, original_html_path: str) -> str:
        """Save extracted text content to a text file."""
        try:
            # Generate text filename based on HTML filename
            html_filename = os.path.basename(original_html_path)
            text_filename = html_filename.replace('.html', '.txt')
            text_filepath = os.path.join(self.text_folder, text_filename)
            
            # Save text file
            with open(text_filepath, 'w', encoding='utf-8') as f:
                f.write(text_content)
            
            logger.info(f"Text file saved: {text_filepath}")
            return text_filepath
            
        except Exception as e:
            logger.error(f"Error saving text file: {str(e)}")
            raise
    
    def process_html_files_with_docling(self, html_files: List[str]) -> List[Dict]:
        """Process all HTML files with docling to extract text content."""
        processed_files = []
        
        try:
            for html_file in html_files:
                logger.info(f"Processing HTML file: {html_file}")
                
                # Extract text using docling
                text_content = self.extract_text_with_docling(html_file)
                
                if text_content:
                    # Save text file
                    text_file = self.save_text_file(text_content, html_file)
                    
                    processed_files.append({
                        'html_file': html_file,
                        'text_file': text_file,
                        'text_length': len(text_content),
                        'extraction_method': 'docling'
                    })
                else:
                    logger.warning(f"No text content extracted from {html_file}")
            
            return processed_files
            
        except Exception as e:
            logger.error(f"Error processing HTML files with docling: {str(e)}")
            raise

def lambda_handler(event, context):
    """AWS Lambda handler function for comprehensive web crawling, text extraction, and image downloading."""
    try:
        # Get API key from environment variables
        api_key = os.environ.get('FIRECRAWL_API_KEY')
        if not api_key:
            raise ValueError("FIRECRAWL_API_KEY environment variable is required")
        
        # Get max pages from event or use default
        max_pages = event.get('max_pages', 500) if event else 500
        
        # Initialize scraper with comprehensive crawling settings
        scraper = FirecrawlLambdaScraper(api_key, max_pages=max_pages)
        
        # Step 1: Crawl the entire website comprehensively
        logger.info("Starting comprehensive website crawl...")
        crawl_result = scraper.crawl_entire_website()
        
        # Step 2: Save all HTML files
        logger.info("Saving HTML files...")
        crawl_data = crawl_result.data if hasattr(crawl_result, 'data') else []
        html_files = scraper.save_html_files(crawl_data)
        
        # Step 3: Process HTML files with docling to extract text
        logger.info("Processing HTML files with docling...")
        processed_files = scraper.process_html_files_with_docling(html_files)
        
        # Step 4: Extract and download all images
        logger.info("Extracting and downloading images...")
        downloaded_images = scraper.extract_and_download_images(html_files)
        
        # Prepare comprehensive response with crawl statistics
        response = {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Successfully completed comprehensive crawl of JioPay website with docling text extraction and image downloading',
                'base_url': scraper.base_url,
                'crawl_statistics': {
                    'total_pages_crawled': len(crawl_data),
                    'unique_urls_discovered': len(scraper.crawled_urls),
                    'failed_urls': len(scraper.failed_urls),
                    'max_pages_limit': scraper.max_pages,
                    'robots_txt_compliance': scraper.robots_parser is not None
                },
                'file_processing': {
                    'html_files_saved': len(html_files),
                    'text_files_processed': len(processed_files),
                    'images_downloaded': len(downloaded_images),
                    'failed_images': len(scraper.failed_images),
                    'extraction_method': 'docling'
                },
                'processed_files': processed_files,
                'downloaded_images': downloaded_images,
                'crawled_urls': list(scraper.crawled_urls),
                'failed_urls': list(scraper.failed_urls),
                'timestamp': datetime.now().isoformat()
            })
        }
        
        logger.info(f"Lambda execution completed successfully. Crawled {len(crawl_data)} pages, downloaded {len(downloaded_images)} images.")
        return response
        
    except Exception as e:
        logger.error(f"Lambda execution failed: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': str(e),
                'message': 'Failed to crawl, extract text, and download images',
                'timestamp': datetime.now().isoformat()
            })
        }

if __name__ == "__main__":
    # Test the lambda function locally
    test_event = {'max_pages': 100}  # Test with smaller limit
    test_context = {}
    
    result = lambda_handler(test_event, test_context)
    print(json.dumps(result, indent=2))