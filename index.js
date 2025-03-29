const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const path = require('path');
const cors = require('cors');
const fetch = require('node-fetch');
const fs = require('fs');
const fsp = fs.promises;
const app = express();
const port = 3001;

// API Anahtarları
const GEMINI_API_KEY = 'AIzaSyAJDng-0HwYRTIZJ9WYbAypiAM8mjPYiEo';
const PIXABAY_API_KEY = '28357747-7116da6964b17fe18530878a9';
const UNSPLASH_ACCESS_KEY = 'rJDs14z8aBCcb5MAMTujpONR6s97dqrjIyDpwT0RgEw';

// CORS ayarları
const corsOptions = {
    origin: ['http://localhost:3001', 'http://127.0.0.1:3001'],
    methods: ['GET', 'POST'],
    credentials: true,
    optionsSuccessStatus: 204,
    maxAge: 86400 // 24 saat önbellek
};
app.use(cors(corsOptions));

// Express middleware ayarları
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// İstek gövdesi analiz hatası kontrolü
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        console.error('İstek gövdesi analiz hatası:', err.message);
        return res.status(400).json({ success: false, error: 'Geçersiz JSON formatı' });
    }
    next();
});

// Statik dosya servis ayarları
app.use(express.static(path.join(__dirname, 'public')));

// Makaleleri saklamak için dosya yolu
const ARTICLES_FILE = path.join(__dirname, 'articles.json');

// Makaleleri yükle
let articleHistory = [];
async function loadArticles() {
    try {
        const data = await fsp.readFile(ARTICLES_FILE, 'utf8');
        articleHistory = JSON.parse(data);
    } catch (error) {
        // Dosya yoksa veya okuma hatası varsa boş dizi kullan
        articleHistory = [];
        // Dosyayı oluştur
        await fsp.writeFile(ARTICLES_FILE, '[]', 'utf8');
    }
}

// Makaleleri kaydet
async function saveArticles() {
    try {
        // Makaleleri JSON formatında dosyaya kaydet
        await fsp.writeFile('./articles.json', JSON.stringify(articleHistory, null, 2), 'utf8');
        console.log('Makaleler dosyaya kaydedildi, toplam:', articleHistory.length);
        return true;
    } catch (error) {
        console.error('Makaleleri kaydetme hatası:', error);
        
        try {
            // Asıl dosyaya yazma başarısız olursa, yedek dosyaya yazmayı dene
            const backupPath = './articles.backup.' + Date.now() + '.json';
            await fsp.writeFile(backupPath, JSON.stringify(articleHistory, null, 2), 'utf8');
            console.log('Makaleler yedek dosyaya kaydedildi:', backupPath);
            return true;
        } catch (backupError) {
            console.error('Yedek dosyaya kaydetme hatası:', backupError);
            return false;
        }
    }
}

// Uygulama başladığında makaleleri yükle
loadArticles();

// Gemini API istemcisini oluştur
let genAI;
let model;

try {
    if (!GEMINI_API_KEY || GEMINI_API_KEY === '') {
        throw new Error('Gemini API anahtarı tanımlanmamış!');
    }
    
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    
    console.log('Gemini API istemcisi başarıyla oluşturuldu');
    } catch (error) {
    console.error('Gemini API istemcisi oluşturulurken hata:', error.message);
    // Uygulamanın hatasız başlatılabilmesi için geçici bir model nesnesi oluştur
    model = {
        generateContent: async () => {
            throw new Error('Gemini API istemcisi düzgün yapılandırılmamış. API anahtarınızı kontrol edin.');
        }
    };
}

// Güvenli Gemini API çağrısı
async function safeGenerateContent(prompt, retry = 2) {
    try {
        console.log(`Gemini API çağrısı yapılıyor (deneme: 1/${retry + 1}), prompt uzunluğu: ${prompt.length}`);
        
        if (!model) {
            throw new Error('Gemini API istemcisi oluşturulmamış');
        }
        
        const result = await model.generateContent(prompt);
        
        if (!result || !result.response) {
            throw new Error('Gemini API boş yanıt döndürdü');
        }
        
        return result;
    } catch (error) {
        console.error(`Gemini API çağrısı hatası (deneme 1/${retry + 1}):`, error.message);
        
        if (retry > 0) {
            console.log(`${retry} deneme hakkı kaldı, 3 saniye sonra tekrar deneniyor...`);
            await new Promise(resolve => setTimeout(resolve, 3000)); // 3 saniye bekle
            return safeGenerateContent(prompt, retry - 1);
        }
        
        throw new Error(`Gemini API çağrısı başarısız oldu: ${error.message}`);
    }
}

// SEO metriklerini hesaplama fonksiyonu
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function checkSEOMetrics(content, keyword) {
    try {
        if (!content || typeof content !== 'string' || !keyword || typeof keyword !== 'string') {
            console.error('Geçersiz içerik veya anahtar kelime');
            return {
                keywordDensity: 0,
                keywordCount: 0,
                h2Score: 0,
                h3Score: 0,
                firstParagraphScore: 0,
                paragraphScore: 0,
                totalScore: 0,
                wordCount: 0,
                h2Count: 0,
                h3Count: 0,
                paragraphCount: 0,
                hiLinkKeyword: 0,
                keywordInH2: 0,
                keywordInH3: 0,
                keywordInParagraph: 0,
                h3PerH2Ratio: 0
            };
        }

        console.log('SEO metrikleri hesaplanıyor... Anahtar kelime:', keyword);

        // Düzenli ifade için anahtar kelimeyi hazırla
        const escapedKeyword = escapeRegExp(keyword);
        const keywordRegex = new RegExp(escapedKeyword, 'gi');
        
        // Anahtar kelime varyasyonları - Türkçe karakterler için alternatifler
        const keywordLower = keyword.toLowerCase();
        const keywordVariations = [
            keywordLower,
            keywordLower.replace(/ç/g, 'c'),
            keywordLower.replace(/ğ/g, 'g'),
            keywordLower.replace(/ı/g, 'i'),
            keywordLower.replace(/ö/g, 'o'),
            keywordLower.replace(/ş/g, 's'),
            keywordLower.replace(/ü/g, 'u')
        ];
        
        // Varyasyonlar için regex
        const variationRegexStr = keywordVariations
            .map(v => escapeRegExp(v))
            .filter((v, i, arr) => arr.indexOf(v) === i) // Tekrarları kaldır
            .join('|');
        const variationRegex = new RegExp(`\\b(${variationRegexStr})\\b`, 'gi');
        
        // Metrikler
        let keywordCount = 0;
        let h2KeywordCount = 0;
        let h3KeywordCount = 0;
        let firstParagraphKeyword = false;
        let firstSentenceKeyword = false;
        let paragraphsWithKeyword = 0;
        
        // İçeriği parçalara ayır
        const h2Tags = content.match(/<h2>(.*?)<\/h2>/gi) || [];
        const h3Tags = content.match(/<h3>(.*?)<\/h3>/gi) || [];
        const paragraphs = content.match(/<p>(.*?)<\/p>/gi) || [];
        
        // H2 başlıkları ile ilişkili H3 başlıklarını bul - yapısal analiz için
        let h2h3Structure = [];
        let currentH2Index = -1;
        
        // HTML'i basit şekilde parse et (gerçek bir HTML parser kullanmak daha iyi olabilir)
        const allTags = content.match(/<(h2|h3|p)>(.*?)<\/(h2|h3|p)>/gi) || [];
        
        for (const tag of allTags) {
            if (tag.match(/<h2>/i)) {
                currentH2Index++;
                h2h3Structure.push({ h2: tag, h3s: [] });
            } else if (tag.match(/<h3>/i) && currentH2Index >= 0) {
                h2h3Structure[currentH2Index].h3s.push(tag);
            }
        }
        
        // H2 başlıklarının altında yeterli H3 başlığı var mı kontrol et
        const h2WithEnoughH3s = h2h3Structure.filter(item => item.h3s.length >= 3).length;
        const h3PerH2Ratio = h2Tags.length > 0 ? h3Tags.length / h2Tags.length : 0;
        
        // Kelime sayısı hesapla (HTML etiketleri temizlenerek)
        const cleanText = content.replace(/<\/?[^>]+(>|$)/g, ' ');
        const words = cleanText.split(/\s+/).filter(word => word.length > 0);
        const wordCount = words.length;
        
        // Anahtar kelime yoğunluğunu hesapla
        keywordCount = (content.match(variationRegex) || []).length;
        const keywordDensity = wordCount > 0 ? (keywordCount / wordCount) * 100 : 0;
        
        // H2 başlıklarında anahtar kelime kontrolü
        h2Tags.forEach(tag => {
            if (tag.match(variationRegex)) {
                h2KeywordCount++;
            }
        });
        
        // H3 başlıklarında anahtar kelime kontrolü
        h3Tags.forEach(tag => {
            if (tag.match(variationRegex)) {
                h3KeywordCount++;
            }
        });
        
        // İlk paragrafta anahtar kelime kontrolü
        if (paragraphs.length > 0) {
            const firstParagraph = paragraphs[0];
            firstParagraphKeyword = firstParagraph.match(variationRegex) !== null;
            
            // İlk cümlede kontrol et
            const firstSentence = firstParagraph.replace(/<\/?p>/g, '').split(/[.!?]+/)[0];
            console.log('İlk cümle kontrol ediliyor:', firstSentence);
            firstSentenceKeyword = firstSentence.match(variationRegex) !== null;
            
            // Debug
            if (firstSentenceKeyword) {
                console.log('İlk cümlede anahtar kelime BULUNDU:', keyword);
            } else {
                console.log('İlk cümlede anahtar kelime bulunamadı:', keyword);
                console.log('İlk cümle:', firstSentence);
            }
        }
        
        // Paragrafların en az %50'sinde anahtar kelime kontrolü
        paragraphs.forEach(paragraph => {
            if (paragraph.match(variationRegex)) {
                paragraphsWithKeyword++;
            }
        });
        
        // Puanlama
        const h2Score = h2Tags.length > 0 ? Math.min((h2KeywordCount / h2Tags.length) * 15, 15) : 0;
        const h3Score = h3Tags.length > 0 ? Math.min((h3KeywordCount / h3Tags.length) * 15, 15) : 0;
        
        // İlk cümlede anahtar kelime varsa tam puan, sadece ilk paragrafta varsa kısmi puan
        const firstParagraphScore = firstSentenceKeyword ? 30 : (firstParagraphKeyword ? 15 : 0);
        
        const paragraphPercentage = paragraphs.length > 0 ? (paragraphsWithKeyword / paragraphs.length) : 0;
        const paragraphScore = Math.min(paragraphPercentage * 40, 20);
        
        // Keyword density puanı (ideal: %1.5-3)
        let keywordDensityScore = 0;
        if (keywordDensity >= 1.5 && keywordDensity <= 3) {
            keywordDensityScore = 20; // Mükemmel
        } else if (keywordDensity > 0.8 && keywordDensity < 4) {
            keywordDensityScore = 15; // İyi
        } else if (keywordDensity > 0 && keywordDensity <= 5) {
            keywordDensityScore = 10; // Orta
        }
        
        // H3 başlık sayısı H2'lerin 3 katı veya daha fazla olmalı - ekstra puan
        const h3Distribution = h2WithEnoughH3s === h2Tags.length ? 15 : 
                               h2WithEnoughH3s > 0 ? 5 : 0;
        
        // Toplam puan (100 üzerinden)
        const totalScore = h2Score + h3Score + firstParagraphScore + paragraphScore + 
                           keywordDensityScore + h3Distribution;
        
        const metrics = {
            keywordDensity: parseFloat(keywordDensity.toFixed(2)),
            keywordCount,
            h2Score: parseInt(h2Score),
            h3Score: parseInt(h3Score),
            firstParagraphScore,
            paragraphScore: parseInt(paragraphScore),
            keywordDensityScore: parseInt(keywordDensityScore),
            h3DistributionScore: h3Distribution,
            totalScore: parseInt(totalScore),
            wordCount,
            h2Count: h2Tags.length,
            h3Count: h3Tags.length,
            paragraphCount: paragraphs.length,
            hiLinkKeyword: 0,
            keywordInH2: h2KeywordCount,
            keywordInH3: h3KeywordCount,
            keywordInParagraph: paragraphsWithKeyword,
            h3PerH2Ratio: parseFloat(h3PerH2Ratio.toFixed(2)),
            h2WithSufficientH3s: h2WithEnoughH3s,
            firstSentenceKeyword: firstSentenceKeyword
        };
        
        console.log('SEO metrikleri:', JSON.stringify(metrics, null, 2));
        return metrics;
    } catch (error) {
        console.error('SEO metrikleri hesaplanırken hata:', error);
        return {
            keywordDensity: 0,
            keywordCount: 0,
            h2Score: 0,
            h3Score: 0,
            firstParagraphScore: 0,
            paragraphScore: 0,
            totalScore: 0,
            wordCount: 0,
            h2Count: 0,
            h3Count: 0,
            paragraphCount: 0,
            hiLinkKeyword: 0,
            keywordInH2: 0,
            keywordInH3: 0,
            keywordInParagraph: 0,
            h3PerH2Ratio: 0
        };
    }
}

// Slug oluşturma fonksiyonu
function createSlug(text) {
  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-')           // Boşlukları tire ile değiştir
    .replace(/[ğ]/g, 'g')           // Türkçe karakterleri değiştir
    .replace(/[ç]/g, 'c')
    .replace(/[ş]/g, 's')
    .replace(/[ı]/g, 'i')
    .replace(/[ö]/g, 'o')
    .replace(/[ü]/g, 'u')
    .replace(/[^a-z0-9\-]/g, '')    // Alfanumerik ve tire dışındaki karakterleri kaldır
    .replace(/\-\-+/g, '-')         // Birden fazla tireyi tek tire ile değiştir
    .replace(/^-+/, '')             // Baştaki tireleri kaldır
    .replace(/-+$/, '');            // Sondaki tireleri kaldır
}

// Ana sayfa
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Anahtar kelime oluşturma endpoint'i
app.post('/generate-keywords', async (req, res) => {
    try {
        const { topic, language } = req.body;
        console.log('Anahtar kelime oluşturma isteği alındı:', req.body);
        
        if (!topic) {
            console.error('Hata: Konu belirtilmedi');
            return res.status(400).json({ success: false, error: 'Konu belirtilmedi' });
        }

        console.log(`Anahtar kelime oluşturuluyor: "${topic}", Dil: ${language || 'tr'}`);

        const prompt = `
        Verilen konu için SEO açısından etkili olacak anahtar kelimeler oluştur. 
        Bunlar, arama motorlarında yüksek sıralamalar elde etmek için kullanılacak.
        
        Konu: "${topic}"
        Dil: ${language === 'en' ? 'İngilizce' : 'Türkçe'}
        
        Ana anahtar kelime ve ilgili uzun kuyruklu anahtar kelimeler üret.
        
        CEVABINDA SADECE anahtar kelimeleri virgüllerle ayırılmış olarak listele, başka bir şey yazma.
        Toplam 5-10 anahtar kelime ve kelime öbeği üret.
        `;

        console.log('Gemini API\'ye gönderilen prompt:', prompt);
        
        const result = await safeGenerateContent(prompt);
        console.log('Gemini API yanıt durumu:', result.response ? 'Başarılı' : 'Başarısız');
        
        if (!result || !result.response) {
            throw new Error('Gemini API\'den geçerli bir yanıt alınamadı');
        }
        
        const response = await result.response;
        const keywords = response.text().trim();
        
        console.log("Oluşturulan anahtar kelimeler:", keywords);
        
        // Yanıt boş veya geçersizse hata döndür
        if (!keywords || keywords.length === 0) {
            throw new Error('Anahtar kelimeler oluşturulamadı: API boş yanıt döndürdü');
        }
        
        res.json({ success: true, keywords });
    } catch (error) {
        console.error("Anahtar kelime oluşturma hatası (ayrıntılı):", error.message, error.stack);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            errorDetails: 'Lütfen farklı bir konu ile tekrar deneyin veya yöneticinize başvurun.'
        });
    }
});

// Başlık oluşturma endpoint'i
app.post('/generate-titles', async (req, res) => {
    try {
        const { topic, keywords, language } = req.body;
        if (!topic) {
            return res.status(400).json({ success: false, error: 'Konu belirtilmedi' });
        }

        console.log(`Başlık önerileri oluşturuluyor: ${topic}, Dil: ${language}`);
        
        const keywordsText = keywords ? `Kullanılacak anahtar kelimeler: ${keywords}` : '';
        
        const prompt = `
        Verilen konu için SEO dostu blog yazısı başlıkları oluştur.
        
        Konu: "${topic}"
        ${keywordsText}
        Dil: ${language === 'en' ? 'İngilizce' : 'Türkçe'}
        
        Başlıklar ilgi çekici ve merak uyandırıcı olmalı, insanların tıklamasını sağlamalı.
        
        Aşağıdaki kurallara uy:
        - Her başlık benzersiz ve yaratıcı olmalı
        - Başlıklar 50-70 karakter arasında olmalı
        - Her başlık "1.", "2." şeklinde numaralandırılmalı
        - Başlıkların içinde anahtar kelimeler doğal bir şekilde kullanılmalı
        - 10 başlık oluştur
        `;

        const result = await safeGenerateContent(prompt);
        const response = await result.response;
        const titles = response.text().trim();
        
        console.log("Oluşturulan başlıklar:", titles);

        res.json({ success: true, titles });
    } catch (error) {
        console.error("Başlık oluşturma hatası:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Alt başlık oluşturma endpoint'i
app.post('/generate-subtitles', async (req, res) => {
    try {
        const { mainTitle, keywords, numSubtitles, language } = req.body;
        if (!mainTitle) {
            return res.status(400).json({ success: false, error: 'Ana başlık belirtilmedi' });
        }

        console.log(`Alt başlık önerileri oluşturuluyor: ${mainTitle}, Alt başlık sayısı: ${numSubtitles || 10}, Dil: ${language}`);
        
        const keywordsText = keywords ? `Kullanılacak anahtar kelimeler: ${keywords}` : '';
        
        const prompt = `
        Verilen ana başlık için SEO dostu alt başlıklar oluştur.
        
        Ana Başlık: "${mainTitle}"
        ${keywordsText}
        Dil: ${language === 'en' ? 'İngilizce' : 'Türkçe'}
        
        Alt başlıklar tutarlı bir makale yapısı oluşturacak şekilde tasarlanmalı.
        
        Aşağıdaki kurallara uy:
        - Her alt başlık benzersiz ve ana konuyu destekleyici olmalı
        - Alt başlıklar 40-60 karakter arasında olmalı
        - Her alt başlık "1.", "2." şeklinde numaralandırılmalı
        - Alt başlıklar içinde anahtar kelimeler doğal bir şekilde kullanılmalı
        - Toplam ${numSubtitles || 10} alt başlık oluştur
        - Alt başlıklar birbirleriyle mantıksal bir sırada olmalı
        `;

        const result = await safeGenerateContent(prompt);
        const response = await result.response;
        const subtitles = response.text().trim();
        
        console.log("Oluşturulan alt başlıklar:", subtitles);

        res.json({ success: true, subtitles });
    } catch (error) {
        console.error("Alt başlık oluşturma hatası:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Görsel arama endpoint'i
app.post('/search-images', async (req, res) => {
    try {
        const { query } = req.body;
        console.log('Görsel arama isteği:', query);

        if (!query) {
            return res.status(400).json({
                success: false,
                error: 'Arama sorgusu boş olamaz'
            });
        }

        // Pixabay API'yi kullan
        const searchUrl = `https://pixabay.com/api/?key=${PIXABAY_API_KEY}&q=${encodeURIComponent(query.replace(/\s+/g, '+'))}&image_type=photo&per_page=12&orientation=horizontal&lang=${req.body.language === 'tr' ? 'tr' : 'en'}`;
        console.log('Pixabay API İsteği URL:', searchUrl);

        const response = await fetch(searchUrl);
        console.log('Pixabay API Yanıt Durumu:', response.status);

        if (!response.ok) {
            throw new Error(`Pixabay API hatası: ${response.status} - ${response.statusText}`);
        }

        const data = await response.json();
        console.log('Pixabay API Yanıt Sonuç Sayısı:', data.hits?.length);

        if (!data.hits || !Array.isArray(data.hits)) {
            throw new Error('Geçersiz API yanıtı');
        }

        const images = data.hits.map(img => ({
            imageUrl: img.largeImageURL,
            thumbnailUrl: img.previewURL,
            title: img.tags.split(',')[0] || query,
            photographer: img.user,
            photographerUrl: `https://pixabay.com/users/${img.user}-${img.user_id}/`,
            downloadUrl: img.largeImageURL,
            attribution: `Fotoğraf: ${img.user} (Pixabay)`
        }));

        res.json({
            success: true,
            images,
            total: data.totalHits || 0
        });

    } catch (error) {
        console.error('Görsel arama hatası:', error);
        res.status(500).json({
            success: false,
            error: `Görsel arama hatası: ${error.message}`
        });
    }
});

// Meta veri oluşturma endpoint'i
app.post('/generate-meta', async (req, res) => {
    try {
        const { title, language } = req.body;
        
        const prompt = `Başlık: "${title}"
        
        Bu başlık için aşağıdaki meta verileri oluştur:
        1. SEO dostu URL slug (sadece küçük harfler, tire ile ayrılmış)
        2. Meta açıklama (150-160 karakter arası)
        3. Meta anahtar kelimeler (5-8 adet, virgülle ayrılmış)
        4. İlgili etiketler (5-7 adet)
        
        Yanıtı aşağıdaki formatta ver:
        SLUG: [slug]
        META AÇIKLAMA: [açıklama]
        ANAHTAR KELİMELER: [kelimeler]
        ETİKETLER: [etiketler]
        
        Tüm içerik ${language === 'tr' ? 'Türkçe' : 'İngilizce'} olmalı.`;

        const result = await safeGenerateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        console.log('Gemini API Yanıtı (Meta):', text);

        // Yanıtı parse et
        const lines = text.split('\n');
        const meta = {
            slug: lines.find(l => l.startsWith('SLUG:'))?.replace('SLUG:', '').trim() || title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            description: lines.find(l => l.startsWith('META AÇIKLAMA:'))?.replace('META AÇIKLAMA:', '').trim() || `${title} hakkında detaylı bilgi ve analiz içeren kapsamlı bir makale.`,
            keywords: lines.find(l => l.startsWith('ANAHTAR KELİMELER:'))?.replace('ANAHTAR KELİMELER:', '').trim() || title,
            tags: lines.find(l => l.startsWith('ETİKETLER:'))?.replace('ETİKETLER:', '').trim() || title
        };

        res.json({ success: true, meta });
    } catch (error) {
        console.error('Hata:', error);
        res.status(500).json({ success: false, error: 'Meta veriler oluşturulurken bir hata oluştu' });
    }
});

// Makale oluşturma endpoint'i
app.post('/generate-article', async (req, res) => {
    try {
        console.log('Makale oluşturma isteği alındı:', JSON.stringify({
            title: req.body.title,
            subtitles: req.body.subtitles ? req.body.subtitles.length : 0,
            keywords: req.body.keywords ? req.body.keywords.length : 0,
            optimize: req.body.optimize,
            reoptimize: req.body.reoptimize
        }));
        
        const { title, subtitles, keywords, optimize, reoptimize, format = 'html', length = 'medium', 
              language = 'tr', tone = 'professional', narrator = 'third_person', 
              targetAudience = 'general', difficultyLevel = 'medium', technicalTermDensity = 'medium', 
              h3PerH2 = '3', exampleCount = '3' } = req.body;
        
        // Eksik parametreleri kontrol et
        if (!title || !title.trim()) {
            return res.status(400).json({ success: false, error: 'Başlık belirtilmedi' });
        }
        
        if (!subtitles || !Array.isArray(subtitles) || subtitles.length === 0) {
            return res.status(400).json({ success: false, error: 'Alt başlıklar belirtilmedi' });
        }
        
        // Anahtar kelimeleri doğrula ve ayarla
        let keyword = '';
        
        if (keywords && Array.isArray(keywords) && keywords.length > 0) {
            keyword = keywords[0]; // İlk anahtar kelimeyi kullan
        }
        
        if (!keyword && keywords && typeof keywords === 'string') {
            const keywordList = keywords.split(',').map(k => k.trim()).filter(Boolean);
            if (keywordList.length > 0) {
                keyword = keywordList[0];
            }
        }
        
        if (!keyword) {
            // Anahtar kelime yoksa, başlıktan üret
            keyword = title.split(' ').filter(word => word.length > 3)[0] || title.split(' ')[0];
            console.log('Anahtar kelime belirtilmediği için başlıktan üretildi:', keyword);
        }
        
        // SEO için slug oluştur
        const slug = createSlug(title);
        console.log('Oluşturulan slug:', slug);

        // Meta açıklama ve etiketler oluştur
        let metaDescription = '';
        let metaTags = [];
        
        try {
            const descResponse = await safeGenerateContent(`Aşağıdaki başlık için SEO dostu bir meta açıklama oluştur. 150-160 karakter uzunluğunda olsun:
${title}

Anahtar kelime: ${keyword}`);
            metaDescription = descResponse.response.text().trim();
            
            const tagsResponse = await safeGenerateContent(`Aşağıdaki başlık için 5-7 adet ilgili etiket (tag) öner. Sadece virgülle ayrılmış liste olarak döndür, başka açıklama ekleme:
${title}

Anahtar kelime: ${keyword}`);
            metaTags = tagsResponse.response.text().trim().split(',').map(tag => tag.trim());
        } catch (e) {
            console.error("Meta bilgileri oluşturulurken hata:", e);
            metaDescription = `${title} hakkında detaylı bilgiler ve öneriler içeren bir makale.`;
            metaTags = [keyword, ...title.split(' ').filter(word => word.length > 3)];
        }

        console.log("Meta açıklama:", metaDescription);
        console.log("Meta etiketler:", metaTags);

        // Makale uzunluğu
        let length_instruction = '';
        let wordCount = 800; // Varsayılan değer
        switch (length) {
            case 'short':
                length_instruction = 'Makale yaklaşık 500-700 kelime uzunluğunda olmalıdır.';
                wordCount = 600;
                break;
            case 'medium':
                length_instruction = 'Makale yaklaşık 700-1000 kelime uzunluğunda olmalıdır.';
                wordCount = 850;
                break;
            case 'long':
                length_instruction = 'Makale yaklaşık 1000-1500 kelime uzunluğunda olmalıdır.';
                wordCount = 1250;
                break;
            default:
                length_instruction = 'Makale yaklaşık 700-1000 kelime uzunluğunda olmalıdır.';
        }

        // Profesyonel yazım teknikleri
        const professionalWritingGuidelines = `
        PROFESYONEL İÇERİK YAZIM TEKNİKLERİ:

        1. GİRİŞ BÖLÜMÜ:
           - İlk cümlede ana anahtar kelimeyi MUTLAKA kullanın
           - Makalenin amacını net bir şekilde açıklayın
           - Okuyucunun ilgisini çekecek bir giriş yapın
           - 3-4 cümleden oluşan güçlü bir giriş paragrafı yazın

        2. GELİŞME BÖLÜMÜ:
           - Her H2 başlığı konunun bir ana bölümünü ele almalı
           - Her H2 başlığının altında tam olarak ${h3PerH2 || 3} adet H3 başlığı bulunmalı
           - Her H3 başlığı, H2 başlığının alt konusunu detaylı açıklamalı
           - Her paragraf 2-4 cümleden oluşmalı
           - Uzun cümlelerden kaçının, kısa ve anlaşılır cümleler kurun
           - Paragraflar arasında doğal geçişler kullanın
           - Tekrarlayan ifadelerden kaçının, zengin bir kelime dağarcığı kullanın

        3. SONUÇ BÖLÜMÜ:
           - Makaledeki ana noktaları özetleyin
           - Ana anahtar kelimeyi sonuç paragrafında tekrar kullanın
           - Okuyucuyu harekete geçirecek bir kapanış yapın

        4. DİL VE ANLATIM:
           - Aktif ses kullanımı tercih edin (pasif değil)
           - Teknik terimler kullanırken açıklamalar ekleyin (Teknik terim seviyesi: ${technicalTermDensity || 'orta'})
           - İstatistikler, örnekler ve gerçeklerle içeriği destekleyin
           - Türkçe dil kurallarına dikkat edin
           - Çeşitli cümle yapıları kullanarak monotonluktan kaçının
        `;

        // Makale alt başlıkları
        const subtitlesText = subtitles.map(subtitle => `- ${subtitle}`).join('\n');

        // SEO yönergelerini belirle (H2 başına istenen sayıda H3 başlığı gereği eklendi)
        let seoGuidelines = `Bu makale SEO açısından optimize edilmeli. Lütfen aşağıdaki SEO kurallarına KESİNLİKLE UYUN:

1. ÇOK ÖNEMLİ: Ana anahtar kelime "${keyword}" makalenin İLK CÜMLESİNDE MUTLAKA kullanılmalıdır. Bu kural kesinlikle ihlal edilmemelidir.
2. Anahtar kelime yoğunluğu %1.5 ile %3 arasında olmalıdır (ideal: %2). Bu kelime sayısına göre anahtar kelimenin minimum ${Math.ceil(wordCount * 0.015)} kez, maksimum ${Math.floor(wordCount * 0.03)} kez geçmesi demektir.
3. HER H2 BAŞLIĞI ALTINDA KESİNLİKLE TAM OLARAK ${h3PerH2 || 3} ADET H3 BAŞLIĞI BULUNMALIDIR. Bu sayı kullanıcı tarafından belirlenmiştir ve tam olarak uyulmalıdır.
4. TÜM H2 ve H3 başlıklarının en az %70'inde ana anahtar kelime veya varyasyonları kullanılmalıdır.
5. En az 5 paragraf olmalı ve paragrafların en az %50'sinde ana anahtar kelime kullanılmalıdır.
6. Anahtar kelimeyi doğal bir şekilde yerleştirin, yapay veya zorlamayla yerleştirilmiş görünmemelidir.
7. Anahtar kelimeyi stratejik yerlerde kullanın: başlıklar, ilk ve son paragraf, alt başlıklar.
8. Makalenin başında aşağıdaki meta bilgileri bölümü eklenmelidir:
   - Başlık: ${title}
   - Slug: ${slug}
   - Özet: ${metaDescription}
   - Anahtar Kelimeler: ${keywords || keyword}
   - Etiketler: ${metaTags.join(', ')}

Makalenin sonuna SEO analizi eklenerek, makalenin SEO puanı, güçlü yönleri ve iyileştirme önerileri belirtilmelidir.

EK UYARI: Bu kuralların herhangi birine uyulmaması SEO puanının düşük çıkmasına ve makalenin reddedilmesine neden olacaktır.`;

        // Makale formatı
        let format_instruction = '';
        if (format === 'html') {
            format_instruction = 'Makaleyi HTML formatında oluşturun. H2 ve H3, paragraf, liste ve vurgulama etiketlerini doğru şekilde kullanın.';
        } else {
            format_instruction = 'Makaleyi düz metin formatında oluşturun. H2 için ## ve H3 için ### kullanın.';
        }

        // Makale üretimi için prompt oluştur
        const prompt = `${seoGuidelines}

${format_instruction}
${length_instruction}

${professionalWritingGuidelines}

Makalenin başlığı: "${title}"

Alt başlıklar:
${subtitlesText}

Makale şu dilde yazılmalı: ${language || 'Türkçe'}
Makale şu tonda yazılmalı: ${tone || 'Bilgilendirici'}
Makale şu anlatıcı tipinde yazılmalı: ${narrator || 'Üçüncü şahıs'}
Makale şu hedef kitleye yönelik yazılmalı: ${targetAudience || 'Genel okuyucu'}
Makale şu zorluk seviyesinde yazılmalı: ${difficultyLevel || 'Orta'}
Makale şu teknik terim yoğunluğuna sahip olmalı: ${technicalTermDensity || 'Orta'}
Makale her bölümde yaklaşık ${exampleCount || '3'} örnek içermeli

ANAHTAR KELİME KULLANIMI:
- Ana anahtar kelime: "${keyword}" (Bu kelimeyi stratejik olarak kullanın)
- Bu anahtar kelime İLK CÜMLEDE mutlaka geçmeli
- Bu anahtar kelime H2 ve H3 başlıkların çoğunda bulunmalı
- Bu anahtar kelime paragrafların en az yarısında bulunmalı

H3 BAŞLIK YAPISI:
- MUTLAKA her H2 başlığının altında tam olarak ${h3PerH2 || 3} adet H3 başlığı olmalı (ne bir eksik ne bir fazla)
- H3 başlıkları ilgili H2 başlığının alt konusu olmalı ve ana anahtar kelimeyi içermeli
- H3 başlıkları 5-7 kelimeden oluşmalı ve bilgilendirici olmalı

MAKALE YAPISI ŞÖYLE OLMALI:

1. Meta Bilgiler Bölümü:
   <div class="meta-info">
      <div class="meta-item"><strong>Başlık:</strong> ${title}</div>
      <div class="meta-item"><strong>Slug:</strong> ${slug}</div>
      <div class="meta-item"><strong>Özet:</strong> ${metaDescription}</div>
      <div class="meta-item"><strong>Anahtar Kelimeler:</strong> ${keywords || keyword}</div>
      <div class="meta-item"><strong>Etiketler:</strong> ${metaTags.join(', ')}</div>
   </div>

2. Giriş (Ana anahtar kelimeyi İLK CÜMLEDE kullanarak)

3. Ana İçerik:
   - Her H2 başlığı altında TAM OLARAK ${h3PerH2 || 3} adet H3 başlığı (bu sayıya kesinlikle uyun)
   - Her bölümde yeterli içerik (en az 100-150 kelime)
   - Anahtar kelimeyi doğal bir şekilde dağıtarak kullanma
   - Bazı anahtar kelimeleri <strong> etiketi ile vurgulama

4. Sonuç (konuyu özetleyip ana anahtar kelimeyi tekrar kullanarak)

5. SEO Analizi:
   <div class="seo-analysis">
      <h3>SEO Analizi</h3>
      <div class="analysis-item"><strong>SEO Puanı:</strong> [Puan]/100</div>
      <div class="analysis-item"><strong>Güçlü Yönler:</strong>
         <ul>
           <li>[Güçlü yön 1]</li>
           <li>[Güçlü yön 2]</li>
         </ul>
      </div>
      <div class="analysis-item"><strong>İyileştirme Önerileri:</strong>
         <ul>
           <li>[Öneri 1]</li>
           <li>[Öneri 2]</li>
         </ul>
      </div>
   </div>

Şimdi lütfen bu yönergelere TAMAMEN UYARAK makalenin tam metnini yazın.`;

        console.log("Gemini API'ye gönderilen prompt uzunluğu:", prompt.length);

        // Gemini API'ye istek gönder
        const result = await safeGenerateContent(prompt);
        let article = result.response.text();
        
        console.log("Makale oluşturuldu, SEO analizi yapılıyor...");

        // HTML formatında değilse, formatla
        if (format !== 'html' && !article.includes('<h2>') && !article.includes('<div class="meta-info">')) {
            // Meta bilgilerini oluştur
            const metaInfoHtml = `<div class="meta-info">
                <div class="meta-item"><strong>Başlık:</strong> ${title}</div>
                <div class="meta-item"><strong>Slug:</strong> ${slug}</div>
                <div class="meta-item"><strong>Özet:</strong> ${metaDescription}</div>
                <div class="meta-item"><strong>Anahtar Kelimeler:</strong> ${keywords || keyword}</div>
                <div class="meta-item"><strong>Etiketler:</strong> ${metaTags.join(', ')}</div>
            </div>`;

            console.log("Markdown'ı HTML'e dönüştürme başlıyor...");
            
            // Makaleyi düzgün şekilde parçala
            let content = article;
            
            // Başlıkları işle - Bunları önce işlemek önemli
            content = content
                .replace(/^# (.*?)$/gm, '<h1>$1</h1>')
                .replace(/^## (.*?)$/gm, '<h2>$1</h2>')
                .replace(/^### (.*?)$/gm, '<h3>$1</h3>');
            
            // Mükerrer satır sonlarını ve boşlukları normalleştir
            content = content.replace(/\r\n/g, '\n'); // Windows satır sonlarını normalleştir 
            content = content.replace(/\n{3,}/g, '\n\n'); // Fazla boş satırları temizle
            
            // Blok elementlerini işlemeden önce metni bölümlere ayır
            const blocks = content.split(/\n{2,}/);
            
            let formattedBlocks = [];
            let inList = false;
            let listItems = [];
            
            // Her bloğu ayrı ayrı işle
            for (const block of blocks) {
                const trimmedBlock = block.trim();
                if (!trimmedBlock) continue; // Boş blokları atla
                
                // Eğer bu bir başlık ise
                if (trimmedBlock.match(/^<h[1-3]>/)) {
                    // Eğer liste işleniyorsa, listeyi tamamla
                    if (inList && listItems.length > 0) {
                        formattedBlocks.push(`<ul>${listItems.join('')}</ul>`);
                        listItems = [];
                        inList = false;
                    }
                    formattedBlocks.push(trimmedBlock);
                }
                // Eğer liste maddesi ise
                else if (trimmedBlock.match(/^[-*] /m)) {
                    // Her satırı ayrı bir liste maddesi olarak işle
                    const itemLines = trimmedBlock.split('\n');
                    
                    for (const line of itemLines) {
                        if (line.trim().match(/^[-*] /)) {
                            inList = true;
                            const itemContent = line.trim().replace(/^[-*] /, '');
                            listItems.push(`<li>${itemContent}</li>`);
                        } else if (line.trim() && inList) {
                            // Eğer liste maddesine devam eden bir satır ise, son liste maddesine ekle
                            if (listItems.length > 0) {
                                listItems[listItems.length - 1] = listItems[listItems.length - 1].replace('</li>', ` ${line.trim()}</li>`);
                            }
                        }
                    }
                } 
                // Diğer blokları paragraf olarak işle
                else {
                    // Eğer liste işleniyorsa ve bu bir paragraf ise, listeyi tamamla
                    if (inList && listItems.length > 0) {
                        formattedBlocks.push(`<ul>${listItems.join('')}</ul>`);
                        listItems = [];
                        inList = false;
                    }
                    
                    // Başlık değilse ve liste değilse, paragraf olarak ekle
                    if (!trimmedBlock.startsWith('<h') && !trimmedBlock.startsWith('<ul>') && !trimmedBlock.startsWith('<ol>')) {
                        // İç içe satırları tek bir paragraf olarak birleştir, varsa satır sonlarını boşluklarla değiştir
                        const paragraphContent = trimmedBlock.replace(/\n/g, ' ');
                        formattedBlocks.push(`<p>${paragraphContent}</p>`);
                    } else {
                        formattedBlocks.push(trimmedBlock);
                    }
                }
            }
            
            // Eğer liste işlemi bitirilemediyse, şimdi tamamla
            if (inList && listItems.length > 0) {
                formattedBlocks.push(`<ul>${listItems.join('')}</ul>`);
            }
            
            // Tüm blokları birleştir
            let formattedArticle = formattedBlocks.join('\n\n');
            
            // İnline formatları işle
            formattedArticle = formattedArticle
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/`(.*?)`/g, '<code>$1</code>')
                .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');
            
            // HTML etiketleri dışındaki ardışık boşlukları tek boşluğa indir 
            formattedArticle = formattedArticle.replace(/>(\s*)</g, '>\n<');
            
            // Son HTML düzeltmeleri - eksik kapatma etiketleri vs.
            const openTagMatches = formattedArticle.match(/<([a-z0-9]+)(?:\s[^>]*)?>/gi) || [];
            const closeTagMatches = formattedArticle.match(/<\/([a-z0-9]+)>/gi) || [];
            
            const openTags = openTagMatches.map(tag => tag.match(/<([a-z0-9]+)/i)[1].toLowerCase());
            const closeTags = closeTagMatches.map(tag => tag.match(/<\/([a-z0-9]+)>/i)[1].toLowerCase());
            
            // Her açılan etiket için bir kapatma etiketi olduğundan emin ol
            for (const openTag of openTags) {
                if (openTag !== 'br' && openTag !== 'hr' && openTag !== 'img' && openTag !== 'input') {
                    const openCount = openTags.filter(tag => tag === openTag).length;
                    const closeCount = closeTags.filter(tag => tag === openTag).length;
                    
                    if (openCount > closeCount) {
                        formattedArticle += `</${openTag}>`;
                    }
                }
            }
            
            // Meta bilgilerini ekle
            article = metaInfoHtml + '\n\n' + formattedArticle;
            
            console.log("HTML dönüştürme tamamlandı.");
        } else if (format === 'html' && !article.includes('<div class="meta-info">')) {
            // Gemini zaten HTML döndürdüyse ama meta bilgileri yoksa
            const metaInfoHtml = `<div class="meta-info">
                <div class="meta-item"><strong>Başlık:</strong> ${title}</div>
                <div class="meta-item"><strong>Slug:</strong> ${slug}</div>
                <div class="meta-item"><strong>Özet:</strong> ${metaDescription}</div>
                <div class="meta-item"><strong>Anahtar Kelimeler:</strong> ${keywords || keyword}</div>
                <div class="meta-item"><strong>Etiketler:</strong> ${metaTags.join(', ')}</div>
            </div>`;
            
            // Meta bilgilerini ekle
            article = metaInfoHtml + '\n\n' + article;
        }

        // SEO analizi için metrikleri kontrol et
        let seoData = checkSEOMetrics(article, keyword);
        console.log('SEO Metrikleri:', JSON.stringify(seoData, null, 2));

        // SEO analizi bölümü yoksa ekle
        if (!article.includes('<div class="seo-analysis">')) {
            const seoAnalysisHtml = generateSEOAnalysisHtml(seoData, keyword);
            
            // Makale sonuna SEO analizi bölümünü ekle
            if (article.includes('</body>')) {
                article = article.replace('</body>', seoAnalysisHtml + '</body>');
            } else {
                article += seoAnalysisHtml;
            }
        } else {
            // SEO analizi bölümü varsa, sunucuda hesaplanan verilerle güncelle
            const seoAnalysisHtml = generateSEOAnalysisHtml(seoData, keyword);
            
            // Regex ile SEO analizi bölümünü bul ve değiştir
            const seoAnalysisRegex = /<div class="seo-analysis">[\s\S]*?<\/div>(\s*<\/div>){1,3}/;
            if (seoAnalysisRegex.test(article)) {
                article = article.replace(seoAnalysisRegex, seoAnalysisHtml);
            } else {
                // Eğer regex tam olarak eşleşmezse, daha basit bir yöntem dene
                const startIndex = article.indexOf('<div class="seo-analysis">');
                if (startIndex !== -1) {
                    // İç içe div'lerin sonunu bulmak için sayaç kullan
                    let divCount = 1;
                    let endIndex = startIndex;
                    
                    while (divCount > 0 && endIndex < article.length) {
                        endIndex++;
                        if (article.substring(endIndex, endIndex + 5) === '<div ') {
                            divCount++;
                        } else if (article.substring(endIndex, endIndex + 6) === '</div>') {
                            divCount--;
                        }
                    }
                    
                    if (endIndex !== -1 && endIndex < article.length) {
                        article = article.substring(0, startIndex) + seoAnalysisHtml + article.substring(endIndex + 6);
                    }
                }
            }
        }

        // SEO puanı düşükse ve optimize isteniyorsa yeniden dene
        let attempts = 1;
        const maxAttempts = 3; // Maximum deneme sayısını 2'den 3'e çıkardık
        
        try {
            while (optimize && seoData.totalScore < 70 && attempts < maxAttempts) {
                console.log(`SEO puanı düşük (${seoData.totalScore}), yeniden deneniyor... Deneme: ${attempts + 1}`);
                
                // Mevcut eksikliklere göre SEO yönergeleri güncellenir
                let improvementPrompt = `Aşağıdaki makaleyi SEO açısından optimize etmeniz ŞART. Mevcut SEO puanı ${seoData.totalScore}/100 ve bu çok düşük. Makaledeki aşağıdaki kritik sorunlar MUTLAKA düzeltilmelidir:`;

                // Her denemede farklı stratejiler kullanalım
                if (attempts === 1) {
                    // İlk deneme - temel SEO sorunlarını giderelim
                    if (seoData.keywordDensity < 1.5) {
                        improvementPrompt += `\n- KRİTİK SORUN: Anahtar kelime yoğunluğu çok düşük (${seoData.keywordDensity.toFixed(2)}%). Hedef: %1.5-3. "${keyword}" kelimesini daha sık kullanın.`;
                    } else if (seoData.keywordDensity > 3) {
                        improvementPrompt += `\n- KRİTİK SORUN: Anahtar kelime yoğunluğu çok yüksek (${seoData.keywordDensity.toFixed(2)}%). Hedef: %1.5-3. "${keyword}" kelimesini daha az kullanın.`;
                    }

                    if (seoData.firstParagraphScore < 30) {
                        improvementPrompt += `\n- KRİTİK SORUN: İlk paragrafta ana anahtar kelime "${keyword}" kullanılmamış. İLK CÜMLEYİ TAMAMEN YENİDEN YAZIN ve anahtar kelimeyi doğal bir şekilde yerleştirin.`;
                    }

                    if (seoData.h3Count < seoData.h2Count * 3) {
                        improvementPrompt += `\n- KRİTİK SORUN: Her H2 başlığı altında en az 3 H3 başlığı bulunmalı. Şu anda toplam ${seoData.h2Count} H2 başlığı ama sadece ${seoData.h3Count} H3 başlığı var. Eksik olan H3 başlıklarını ekleyin ve bunlarda anahtar kelimeyi kullanın.`;
                    }
                } else if (attempts === 2) {
                    // İkinci deneme - içeriğin kalitesini ve yapısını iyileştirelim
                    improvementPrompt += `\n- Makaleyi TAMAMEN YENİDEN YAPILANDIRIN. Aşağıdaki yapıyı kullanın:
1. Giriş: İlk cümlede anahtar kelimeyi kullanın
2. Ana bölümler: Her H2 için en az 3 H3 başlığı kullanın
3. Her H2 ve H3 başlığında anahtar kelime olmalı
4. Her paragrafta 2-4 cümle olmalı ve paragrafların yarısından fazlasında anahtar kelime olmalı
5. Sonuç: Anahtar kelimeyi tekrar kullanarak güçlü bir kapanış yapın`;

                    improvementPrompt += `\n\nOrijinal makale tamamen yeniden yazılabilir, sadece başlık ve alt başlıkların konuları korunmalıdır.`;
                }

                // Her durumda kontrol edilmesi gereken hususlar
                if (seoData.h2Score < 10) {
                    improvementPrompt += `\n- H2 başlıklarında anahtar kelime kullanımı yetersiz. Her H2 başlığına "${keyword}" kelimesini veya varyasyonlarını ekleyin.`;
                }

                if (seoData.h3Score < 10) {
                    improvementPrompt += `\n- H3 başlıklarında anahtar kelime kullanımı yetersiz. Her H3 başlığına "${keyword}" kelimesini veya varyasyonlarını ekleyin.`;
                }

                if (seoData.paragraphScore < 15) {
                    improvementPrompt += `\n- Daha fazla paragrafta anahtar kelime kullanılmalı. "${keyword}" kelimesini farklı paragraflara dağıtın.`;
                }

                if (seoData.wordCount < 600) {
                    improvementPrompt += `\n- İçerik çok kısa (${seoData.wordCount} kelime). En az 750 kelime olmalı.`;
                }

                improvementPrompt += `\n\nÇOK ÖNEMLİ KURALLAR:
1. Makale meta bilgileri bölümü korunmalı
2. Her H2 başlığının altında en az 3 H3 başlığı OLMAK ZORUNDA
3. Ana anahtar kelime MUTLAKA ilk cümlenin içinde geçmeli
4. Anahtar kelime yoğunluğu %1.5-%3 arasında olmalı
5. SEO analizi bölümü yeniden oluşturulmalı

Makale:
${article}`;

                // Gemini API'ye yeniden istek gönder
                console.log("İyileştirme için yeni istek gönderiliyor...");
                const improvedResult = await safeGenerateContent(improvementPrompt);
                let improvedArticle = improvedResult.response.text();
                
                // Meta bilgileri ve SEO analizi bölümünü koruyup korumadığını kontrol et
                if (!improvedArticle.includes('<div class="meta-info">')) {
                    // Meta bilgilerini yeniden ekle
                    const metaInfoHtml = `<div class="meta-info">
                        <div class="meta-item"><strong>Başlık:</strong> ${title}</div>
                        <div class="meta-item"><strong>Slug:</strong> ${slug}</div>
                        <div class="meta-item"><strong>Özet:</strong> ${metaDescription}</div>
                        <div class="meta-item"><strong>Anahtar Kelimeler:</strong> ${keywords || keyword}</div>
                        <div class="meta-item"><strong>Etiketler:</strong> ${metaTags.join(', ')}</div>
                    </div>`;
                    improvedArticle = metaInfoHtml + improvedArticle;
                }
                
                // Güncellenmiş SEO metrikleri al
                const improvedSeoData = checkSEOMetrics(improvedArticle, keyword);
                console.log(`İyileştirilmiş SEO puanı: ${improvedSeoData.totalScore} (Önceki: ${seoData.totalScore})`);
                
                // SEO analizi bölümünü güncelle
                const seoAnalysisHtml = generateSEOAnalysisHtml(improvedSeoData, keyword);
                
                // SEO analizi bölümünü ekle veya güncelle
                if (improvedArticle.includes('<div class="seo-analysis">')) {
                    improvedArticle = improvedArticle.replace(/<div class="seo-analysis">[\s\S]*?<\/div>/g, seoAnalysisHtml);
                } else {
                    improvedArticle += seoAnalysisHtml;
                }
                
                // Eğer yeni SEO puanı daha yüksekse, yeni makaleyi kullan
                if (improvedSeoData.totalScore > seoData.totalScore) {
                    console.log(`Optimize edilmiş makale SEO puanı: ${improvedSeoData.totalScore} (Önceki: ${seoData.totalScore})`);
                    article = improvedArticle;
                    seoData = improvedSeoData;
                } else {
                    console.log(`Optimize edilmiş makale SEO puanı daha iyi değil: ${improvedSeoData.totalScore} (Önceki: ${seoData.totalScore})`);
                }
                
                attempts++;
            }
        } catch (optimizationError) {
            console.error('Optimize etme sırasında hata:', optimizationError.message, optimizationError.stack);
            // Hata olsa bile devam et, en azından orijinal makaleyi döndürelim
        }

        // Meta verileri hazırla
        const meta = {
            title,
            slug,
            description: metaDescription,
            keywords: keywords || keyword,
            tags: metaTags
        };

        console.log("Başarıyla oluşturuldu, yanıt gönderiliyor...");
        
        // Debug log olarak başarılı işlemi kaydet
        console.log(`${title} başlıklı makale başarıyla oluşturuldu. SEO puanı: ${seoData.totalScore}`);
        
        // Başarılı yanıtı gönder
        res.json({ 
            success: true, 
            article,
            seoData,
            meta
        });
    } catch (error) {
        // Detaylı hata günlüğü
        console.error('----------------------------------------');
        console.error('MAKALE OLUŞTURMA HATASI');
        console.error('Hata mesajı:', error.message);
        console.error('Hata stack:', error.stack);
        
        // İsteği yeniden gönderme bilgileri
        const requestInfo = {
            title: req.body.title || 'Belirtilmemiş',
            subtitles: req.body.subtitles ? req.body.subtitles.length : 0,
            keywords: req.body.keywords || 'Belirtilmemiş'
        };
        console.error('İstek verileri:', JSON.stringify(requestInfo));
        console.error('----------------------------------------');
        
        // Kullanıcıya anlamlı hata mesajı gönder
        let userFriendlyMessage = 'Makale oluşturulurken bir sorun oluştu.';
        
        if (error.message.includes('API')) {
            userFriendlyMessage = 'Gemini API ile iletişim kurarken bir hata oluştu. Lütfen daha sonra tekrar deneyin.';
        } else if (error.message.includes('timeout') || error.message.includes('zaman aşımı')) {
            userFriendlyMessage = 'İşlem çok uzun sürdüğü için zaman aşımına uğradı. Lütfen daha kısa bir makale oluşturmayı deneyin.';
        } else if (error.message.includes('key') || error.message.includes('anahtar')) {
            userFriendlyMessage = 'API anahtarı ile ilgili bir sorun var. Lütfen site yöneticisine başvurun.';
        }
        
        // Hata yanıtını gönder
        res.status(500).json({ 
            success: false, 
            error: userFriendlyMessage,
            errorType: error.name,
            errorDetails: 'Lütfen daha kısa bir makale oluşturmayı deneyin veya başka anahtar kelimeler kullanın.'
        });
    }
});

// SEO analizi HTML'i oluşturma fonksiyonu
function generateSEOAnalysisHtml(seoData, keyword) {
    // SEO verisi boş veya tanımsızsa varsayılan bir nesne oluştur
    if (!seoData) {
        console.error('SEO verileri bulunamadı, varsayılan veriler kullanılıyor');
        seoData = {
            keywordDensity: 0,
            keywordCount: 0,
            h2Score: 0,
            h3Score: 0,
            firstParagraphScore: 0,
            paragraphScore: 0,
            totalScore: 0,
            wordCount: 0,
            h2Count: 0,
            h3Count: 0,
            paragraphCount: 0,
            hiLinkKeyword: 0,
            keywordInH2: 0,
            keywordInH3: 0,
            keywordInParagraph: 0,
            h3PerH2Ratio: 0,
            h2WithSufficientH3s: 0
        };
    }
    
    const strengths = [];
    const improvements = [];
    
    // Güçlü yönleri belirle
    if (seoData.keywordDensity >= 1.5 && seoData.keywordDensity <= 3) {
        strengths.push(`Anahtar kelime yoğunluğu ideal aralıkta: %${seoData.keywordDensity.toFixed(2)}`);
    }
    
    if (seoData.firstParagraphScore === 30) {
        strengths.push(`İlk paragrafın ilk cümlesinde anahtar kelime doğru kullanılmış`);
    } else if (seoData.firstParagraphScore === 15) {
        strengths.push(`İlk paragrafta anahtar kelime kullanılmış`);
    }
    
    if (seoData.h2Score >= 10) {
        strengths.push(`H2 başlıklarında anahtar kelime kullanımı iyi: ${seoData.keywordInH2}/${seoData.h2Count} başlıkta kullanılmış`);
    }
    
    if (seoData.h3Score >= 10) {
        strengths.push(`H3 başlıklarında anahtar kelime kullanımı iyi: ${seoData.keywordInH3}/${seoData.h3Count} başlıkta kullanılmış`);
    }
    
    if (seoData.h2Count >= 2) {
        strengths.push(`Yeterli sayıda H2 başlığı kullanılmış: ${seoData.h2Count}`);
    }
    
    if (seoData.h2WithSufficientH3s === seoData.h2Count && seoData.h2Count > 0) {
        strengths.push(`Tüm H2 başlıkları altında yeterli sayıda H3 başlığı var: Her H2 başlığı için ortalama ${seoData.h3PerH2Ratio.toFixed(1)} H3 başlığı`);
    } else if (seoData.h2WithSufficientH3s > 0) {
        strengths.push(`Bazı H2 başlıkları altında yeterli sayıda H3 başlığı var: ${seoData.h2WithSufficientH3s}/${seoData.h2Count} H2 başlığı için`);
    }
    
    if (seoData.wordCount >= 750) {
        strengths.push(`İçerik uzunluğu iyi: ${seoData.wordCount} kelime`);
    }
    
    if (seoData.paragraphCount >= 5 && seoData.keywordInParagraph >= seoData.paragraphCount * 0.5) {
        strengths.push(`Paragrafların %${Math.round((seoData.keywordInParagraph / seoData.paragraphCount) * 100)}'inde anahtar kelime kullanılmış`);
    }
    
    // İyileştirme önerilerini belirle
    if (seoData.keywordDensity < 1.5) {
        improvements.push(`Anahtar kelime yoğunluğu düşük (%${seoData.keywordDensity.toFixed(2)}). Hedef: %1.5-3. Anahtar kelimeyi daha sık kullanmalısınız.`);
    } else if (seoData.keywordDensity > 3) {
        improvements.push(`Anahtar kelime yoğunluğu çok yüksek (%${seoData.keywordDensity.toFixed(2)}). Hedef: %1.5-3. Anahtar kelimeyi daha az kullanmalısınız.`);
    }
    
    if (seoData.firstParagraphScore < 15) {
        improvements.push(`İlk paragrafta ana anahtar kelime kullanılmamış. Bu büyük bir SEO hatasıdır.`);
    } else if (seoData.firstParagraphScore < 30) {
        improvements.push(`İlk paragrafta anahtar kelime var, ancak ilk cümlede kullanılmamış. İlk cümlede kullanmak SEO puanını yükseltir.`);
    }
    
    if (seoData.h2Score < 10) {
        improvements.push(`H2 başlıklarında anahtar kelime kullanımı yetersiz: Sadece ${seoData.keywordInH2}/${seoData.h2Count} başlıkta kullanılmış.`);
    }
    
    if (seoData.h3Score < 10) {
        improvements.push(`H3 başlıklarında anahtar kelime kullanımı yetersiz: Sadece ${seoData.keywordInH3}/${seoData.h3Count} başlıkta kullanılmış.`);
    }
    
    if (seoData.h2Count < 2) {
        improvements.push(`Daha fazla H2 başlığı kullanılmalı. Şu an: ${seoData.h2Count}, önerilen: en az 2`);
    }
    
    if (seoData.h2WithSufficientH3s < seoData.h2Count) {
        const missingH3Count = Math.max(0, (seoData.h2Count * 3) - seoData.h3Count);
        improvements.push(`Her H2 başlığı altında en az 3 H3 başlığı kullanılmalı. Şu an: ${seoData.h2WithSufficientH3s}/${seoData.h2Count} H2 başlığında yeterli H3 var. En az ${missingH3Count} adet daha H3 başlığı eklemelisiniz.`);
    }
    
    if (seoData.wordCount < 600) {
        improvements.push(`İçerik daha uzun olmalı. Şu an: ${seoData.wordCount} kelime, önerilen: en az 750 kelime`);
    } else if (seoData.wordCount < 750) {
        improvements.push(`İçerik biraz daha uzun olabilir. Şu an: ${seoData.wordCount} kelime, önerilen: en az 750 kelime`);
    }
    
    if (seoData.keywordInParagraph < seoData.paragraphCount * 0.5) {
        improvements.push(`Daha fazla paragrafta anahtar kelime kullanılmalı. Şu an: Paragrafların %${Math.round((seoData.keywordInParagraph / seoData.paragraphCount) * 100)}'inde kullanılmış, hedef: en az %50`);
    }
    
    if (improvements.length === 0) {
        improvements.push("SEO açısından belirgin bir eksiklik yok. Tebrikler!");
    }
    
    // Renk kodlu puan
    let scoreColorClass = "seo-score-low";
    if (seoData.totalScore >= 70) {
        scoreColorClass = "seo-score-high";
    } else if (seoData.totalScore >= 40) {
        scoreColorClass = "seo-score-medium";
    }
    
    return `<div class="seo-analysis">
    <h3>SEO Analizi</h3>
    
    <div class="analysis-item">
        <strong>SEO Puanı:</strong> <span class="${scoreColorClass}">${seoData.totalScore}/100</span>
    </div>
    
    <div class="analysis-item">
        <strong>Anahtar Kelime:</strong> "${keyword}"
    </div>
    
    <div class="analysis-item">
        <strong>Anahtar Kelime Metrikleri:</strong>
        <ul>
            <li>Yoğunluk: %${seoData.keywordDensity.toFixed(2)} (ideal: %1.5-3)</li>
            <li>Toplam kullanım: ${seoData.keywordCount} kez</li>
            <li>H2 başlıklarında: ${seoData.keywordInH2}/${seoData.h2Count} başlıkta</li>
            <li>H3 başlıklarında: ${seoData.keywordInH3}/${seoData.h3Count} başlıkta</li>
            <li>Paragraf sayısı: ${seoData.paragraphCount}</li>
            <li>Anahtar kelime içeren paragraf: ${seoData.keywordInParagraph} adet (${Math.round((seoData.keywordInParagraph / seoData.paragraphCount) * 100)}%)</li>
            <li>H3/H2 oranı: ${seoData.h3PerH2Ratio.toFixed(1)} (ideal: en az 3)</li>
        </ul>
    </div>
    
    <div class="analysis-item">
        <strong>Güçlü Yönler:</strong>
        <ul>
            ${strengths.map(item => `<li>${item}</li>`).join('\n            ')}
        </ul>
    </div>
    
    <div class="analysis-item">
        <strong>İyileştirme Önerileri:</strong>
        <ul>
            ${improvements.map(item => `<li>${item}</li>`).join('\n            ')}
        </ul>
    </div>
    
    <div class="action-section">
        <p>SEO puanını artırmak için iyileştirme önerilerini dikkate alın ve "SEO Önerilerine Göre Makaleyi Yeniden Yaz" butonunu kullanarak makaleyi yeniden oluşturun.</p>
    </div>
</div>`;
}

// Makale kaydetme endpoint'i
app.post('/save-article', async (req, res) => {
    console.log('Makale kaydetme isteği alındı');
    
    try {
        // İstek yükünü kontrol et
        if (!req.body) {
            console.error('Hata: Boş istek gövdesi');
            return res.status(400).json({ success: false, error: 'Geçersiz istek gövdesi' });
        }
        
        // Gerekli verileri çıkart
        const { title: rawTitle, content, meta = {}, seoData = {} } = req.body;
        
        // Zorunlu alanları kontrol et
        if (!rawTitle || !content) {
            console.error('Hata: Eksik veriler:', {
                hasTitle: !!rawTitle, 
                hasContent: !!content,
                contentLength: content ? content.length : 0
            });
            return res.status(400).json({ success: false, error: 'Başlık ve içerik zorunludur' });
        }
        
        // Başlığı temizle
        const title = rawTitle.trim();
        
        // İçerik uzunluğunu kontrol et
        if (content.length < 100) {
            console.warn('Uyarı: Çok kısa içerik:', content.length);
        }
        
        console.log(`Makale kaydediliyor: "${title.substring(0, 30)}${title.length > 30 ? '...' : ''}" (İçerik: ${content.length} karakter)`);
        
        // Yeni makale oluştur
        const article = {
            id: Date.now().toString(),
            title: title,
            content: content,
            meta: meta,
            seoData: seoData,
            createdAt: new Date().toISOString()
        };
        
        // Makaleyi diziye ekle
        articleHistory.unshift(article);
        console.log('Makale listeye eklendi');
        
        // Diziyi sınırla (son 50 makaleyi tut)
        if (articleHistory.length > 50) {
            console.log('Makale sınırı aşıldı, eski makaleler kaldırılıyor');
            articleHistory.length = 50;
        }
        
        // Makaleleri dosyaya kaydet
        try {
            console.log('Makaleler dosyaya kaydediliyor...');
            const saveResult = await saveArticles();
            
            if (!saveResult) {
                console.warn('Makaleler dosyaya kaydedilemedi, ancak hafızada tutulacak');
            }
        } catch (saveError) {
            console.error('Dosyaya kaydetme hatası:', saveError);
            // Kaydetme hatası olsa bile, hafızadaki bilgiler kaybolmaz
            // Kullanıcıya sadece uyarı vereceğiz
        }
        
        console.log(`Makale işlemi tamamlandı, ID: ${article.id}`);
        
        // Başarılı yanıt gönder
        return res.json({
            success: true,
            article: {
                id: article.id,
                title: article.title,
                createdAt: article.createdAt
            },
            message: 'Makale başarıyla kaydedildi'
        });
        
    } catch (error) {
        console.error('Makale kaydetme işlemi sırasında hata:', error);
        return res.status(500).json({ 
            success: false, 
            error: 'Sunucu hatası: ' + error.message 
        });
    }
});

// Makale geçmişini getirme endpoint'i
app.get('/article-history', (req, res) => {
    // Makaleleri tarihe göre sırala (en yeniden en eskiye)
    const sortedArticles = [...articleHistory].sort((a, b) => 
        new Date(b.date) - new Date(a.date)
    );
    
    res.json({ success: true, articles: sortedArticles });
});

// Makale silme endpoint'i
app.delete('/delete-article/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const index = articleHistory.findIndex(article => article.id === id);
        
        if (index === -1) {
            return res.status(404).json({ success: false, error: 'Makale bulunamadı' });
        }
        
        articleHistory.splice(index, 1);
        await saveArticles();
        
        res.json({ success: true, message: 'Makale başarıyla silindi' });
    } catch (error) {
        console.error('Hata:', error);
        res.status(500).json({ success: false, error: 'Makale silinirken bir hata oluştu' });
    }
});

// Makale güncelleme endpoint'i
app.put('/update-article/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { title, content, meta, seoData } = req.body;
        
        const index = articleHistory.findIndex(article => article.id === id);
        
        if (index === -1) {
            return res.status(404).json({ success: false, error: 'Makale bulunamadı' });
        }
        
        articleHistory[index] = {
            ...articleHistory[index],
            title,
            content,
            meta,
            seoData,
            lastModified: new Date().toISOString()
        };
        
        await saveArticles();
        
        res.json({ success: true, article: articleHistory[index] });
    } catch (error) {
        console.error('Hata:', error);
        res.status(500).json({ success: false, error: 'Makale güncellenirken bir hata oluştu' });
    }
});

// Sunucuyu başlat
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});