// ==UserScript==
// @name         solver
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  ?
// @author       n3kit91
// @match        https://animebuff.ru/quiz/guessAnime
// @grant        GM_xmlhttpRequest
// @connect      api.trace.moe
// @connect      shikimori.one
// ==/UserScript==

(function() {
    'use strict';

    function getImageURLs() {
        const images = document.querySelectorAll('img.slick-slide');
        return Array.from(images).slice(0, 2).map(img => img.src.split('.jpg')[0] + '.jpg');
    }

    async function getImageBlob(url) {
        const response = await fetch(url, { mode: 'cors' });
        return response.blob();
    }

    async function getAnimeTitle(searchTitle) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://shikimori.one/api/animes?search=${searchTitle}`,
                onload: function(response) {
                    try {
                        const shikimoriData = JSON.parse(response.responseText);
                        if (shikimoriData.length > 0) {
                            resolve(shikimoriData[0].russian);
                        } else {
                            reject(new Error('Аниме не найдено на Shikimori'));
                        }
                    } catch (error) {
                        reject(error);
                    }
                },
                onerror: function(error) {
                    reject(error);
                }
            });
        });
    }

    async function identifyAnime(blob) {
        const formData = new FormData();
        formData.append('image', blob);
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: 'https://api.trace.moe/search',
                data: formData,
                onload: async function(response) {
                    try {
                        const data = JSON.parse(response.responseText);
                        resolve(data);
                    } catch (e) {
                        reject(new Error('Invalid JSON response'));
                    }
                },
                onerror: function(error) {
                    reject(error);
                }
            });
        });
    }

    function saveToLocalStorage(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    function getFromLocalStorage(key) {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : null;
    }

    function generateStorageKey(url) {
        return `anime_${url}`;
    }

    async function displayResults(resultsContainer, data) {
        if (data && data.result && data.result.length > 0) {
            const resultsToShow = data.result.slice(0, 5);
            const titles = new Set();
            for (const result of resultsToShow) {
                try {
                    const searchTitle = result.filename.split('/')[0];
                    const title = await getAnimeTitle(searchTitle);
                    const accuracy = (result.similarity * 100).toFixed(2);
                    if (!titles.has(title)) {
                        titles.add(title);
                        appendResultItem(resultsContainer, title, accuracy);
                    }
                } catch (error) {
                    console.error('Ошибка при получении названия аниме:', error);
                }
            }
            return Array.from(titles);
        } else {
            return [];
        }
    }

    function createResultsContainer() {
        const container = document.createElement('div');
        container.style.position = 'fixed';
        container.style.top = '50%';
        container.style.left = '50%';
        container.style.transform = 'translate(-50%, -50%)';
        container.style.backgroundColor = 'white';
        container.style.padding = '10px';
        container.style.border = '1px solid black';
        container.style.zIndex = '9999';
        container.style.fontSize = '110%';
        return container;
    }

    function appendResultItem(container, text, accuracy) {
        const item = document.createElement('div');
        item.style.marginBottom = '10px';
        item.innerHTML = `${text} (${accuracy}%)<br>`;
        const red = Math.round(255 * (1 - accuracy / 100));
        const green = Math.round(255 * (accuracy / 100));
        item.style.backgroundColor = `rgba(${red}, ${green}, 0, 0.5)`;
        container.appendChild(item);
    }

    function levenshtein(a, b) {
        const an = a ? a.length : 0;
        const bn = b ? b.length : 0;
        if (an === 0) return bn;
        if (bn === 0) return an;
        const matrix = new Array(bn + 1);
        for (let i = 0; i <= bn; ++i) {
            let row = matrix[i] = new Array(an + 1);
            row[0] = i;
        }
        const firstRow = matrix[0];
        for (let j = 1; j <= an; ++j) {
            firstRow[j] = j;
        }
        for (let i = 1; i <= bn; ++i) {
            for (let j = 1; j <= an; ++j) {
                if (b[i - 1] === a[j - 1]) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
                    );
                }
            }
        }
        return matrix[bn][an];
    }

    function compareTitles(answerText, title) {
        const distance = levenshtein(answerText.toLowerCase(), title.toLowerCase());
        const maxLen = Math.max(answerText.length, title.length);
        const similarity = (maxLen - distance) / maxLen;
        return similarity > 0.95;
    }

    function selectAnswer(animeTitles) {
        const answers = document.querySelectorAll('.quiz-variants__item');
        for (const answer of answers) {
            const answerTextElement = answer.querySelector('.quiz-variants__text');
            if (answerTextElement) {
                const answerText = answerTextElement.innerText;
                for (const title of animeTitles) {
                    if (compareTitles(answerText, title)) {
                        answer.style.backgroundColor = 'orange';
                        answer.click();
                        setTimeout(() => {
                            location.reload(true);
                        }, 1000);
                        return true;
                    }
                }
            }
        }
        return false;
    }

    async function main() {
        const imageUrls = getImageURLs();
        if (imageUrls.length > 0) {
            const reloadTimeout = setTimeout(() => {
                location.reload(true);
            }, 20000);
            try {
                const resultsContainer = createResultsContainer();
                document.body.appendChild(resultsContainer);
                const blobs = await Promise.all(imageUrls.map(url => getImageBlob(url)));
                const results = await Promise.all(blobs.map(blob => identifyAnime(blob)));
                const titles = new Set();
                for (let i = 0; i < imageUrls.length; i++) {
                    const url = imageUrls[i];
                    const key = generateStorageKey(url);
                    let titlesFromResult = getFromLocalStorage(key);
                    if (!titlesFromResult) {
                        titlesFromResult = await displayResults(resultsContainer, results[i]);
                        saveToLocalStorage(key, titlesFromResult);
                    } else {
                        titlesFromResult.forEach(title => appendResultItem(resultsContainer, title, 'N/A'));
                    }
                    titlesFromResult.forEach(title => titles.add(title));
                }
                const answerFound = selectAnswer(Array.from(titles));
                setTimeout(() => {
                    resultsContainer.style.transition = 'opacity 1s';
                    resultsContainer.style.opacity = '0';
                    setTimeout(() => {
                        resultsContainer.remove();
                    }, 1000);
                }, 2000);
                if (titles.size === 0 || !answerFound) {
                    setTimeout(() => {
                        location.reload(true);
                    }, 2000);
                } else {
                    clearTimeout(reloadTimeout);
                }
            } catch (error) {
                clearTimeout(reloadTimeout);
            }
        }
    }

    main();
})();
