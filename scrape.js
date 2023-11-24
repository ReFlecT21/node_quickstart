

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const Chance = require('chance');

const axios = require('axios');
const apiKey = process.env.GOOGLE_MAPS_API_KEY;
const chance = new Chance()



async function fetchTimeOutHotList() {

    // const hotListJson = fs.readFileSync('data/timeoutHotList.txt', 'utf8');
    // const fetchedHotList = JSON.parse(hotListJson);
    // console.log(fetchedHotList[0].title);
    const browser = await puppeteer.launch({
        headless: false
    });
    const page = await browser.newPage();
    await page.goto('https://www.timeout.com/singapore/things-to-do/the-time-out-singapore-hotlist');

    const events = await page.evaluate(() => 
        Array.from(document.querySelectorAll('div._zoneItems_882m9_1.zoneItems article'), (e) => {
            const titleElement = e.querySelector('._h3_cuogz_1');
            const imagesElements = e.querySelector('div._imageContainer_kc5qn_33 div._imageWrap_kc5qn_229 img');
            const imgSrc = imagesElements ? imagesElements.getAttribute('src') : null;
            const url = e.querySelector('div._title_kc5qn_9 a').getAttribute('href');
            
            return {
                title: titleElement ? titleElement.innerText: null,
                imgSrc: imgSrc, 
                url: url? "https://www.timeout.com" + url : null,
            }
        }) 
    );

    for (let event of events) {
        const page = await browser.newPage();
        // console.log('Fetching additional information for ' + event.title);
        await page.goto(event.url);

        // Click the "Show more" button until it no longer exists
        let loadMoreButtonExists = true;
        let buttonPressed = 0;

        await page.setRequestInterception(true);
        page.on('request', (request) => {
            // If the request is for an image or stylesheet, abort it
            if (request.resourceType() === 'image' || request.resourceType() === 'stylesheet') {
                request.abort();
            } else {
                request.continue();
            }
        });

        while (loadMoreButtonExists) {
            // console.log('Clicking "Show more" button', ++buttonPressed);
            page.on('dialog', async dialog => {
                await dialog.dismiss();
            });

            await page.evaluate(() => {
                const adElement = document.querySelector('div._adsContainer_1q8qx_18');
                if (adElement) {
                  adElement.remove();
                }
            });

            try {
                try {
                    const adCloseButton = await page.waitForSelector('div._overlay_kzzn5_1 button._closeButton_kzzn5_73',{timeout: 2000});
                    if (adCloseButton) {
                        await adCloseButton.click();  // Wait for the ad to close
                    }
                } catch (error) {
                    // console.log('No advertisement found:', error.message);
                }
                await page.waitForSelector('div._ctaContainer_1wb4w_15 div._viewMoreCta_1wb4w_20 a', { timeout: 2000 });
                await page.click('div._ctaContainer_1wb4w_15 div._viewMoreCta_1wb4w_20 a');
                // Add a delay here
                await page.waitForTimeout(2000);
            } catch (error) {
                // console.log(error.message);
                loadMoreButtonExists = false;
            }
        }

        const eventDetails = await page.evaluate(() => {
            const detailsElement = document.querySelector('div[data-section="details"]');
            const priceElement = document.querySelector('div[data-section="price"]');
            
            const address = detailsElement ? Array.from(detailsElement.querySelectorAll('dd._description_k1wdy_9')).map(el => el.textContent).join(', ') : null;
            const price = priceElement ? priceElement.querySelector('dd._description_k1wdy_9').textContent : null;

            const dateTimesElements = document.querySelectorAll('div.zoneItems div._articleRow_14oc2_1 time');
            const dateTimes = Array.from(dateTimesElements).map(el => el.getAttribute('datetime'));

            return {
                address: address,
                price: price,
                startDate: dateTimes[0],  // First element of dateTimes
                endDate: dateTimes[dateTimes.length - 1]
            };
        });

        // console.log(eventDetails);

        event.address = eventDetails.address;
        event.price = eventDetails.price;
        event.startEndDate = [eventDetails.startDate, eventDetails.endDate];
        await page.close();
    }

    await browser.close();

    return events;
}

// Wait for function to execute before adding to database
fetchTimeOutHotList().then((events) => {
    const eventsJson = JSON.stringify(events, null, 2);
    scrapePath = path.join(__dirname, 'data', 'timeoutHotList.txt');
    fs.writeFileSync(scrapePath, eventsJson);
    console.log('Pushing to DB');

    // for(let event of events){
    //     console.log(event.title, event.address);
    // }
    const hotListJson = fs.readFileSync('data/timeoutHotList.txt', 'utf8');
    const fetchedHotList = JSON.parse(hotListJson); 
    console.log(fetchedHotList);

    for (let event of fetchedHotList){
        // if no address, skip event
        if (event.address == "" || event.address==null){
            console.log('No address for:', event.title)
            continue;
        }else{
            // retrieving the coordinates for the address
            let address = event.address;
            let url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`
            axios.get(url)
            .then(response=> {
                // if response data is not empty, add lat and lng to event 
                if(response.data.results.length > 0){
                    let location = response.data.results[0].geometry.location;
                    console.log('Address for: ', event.title, ':', location.lat, location.lng);
                    event.lat = location.lat;
                    event.lng = location.lng;
                }
                else{
                    console.log('No results found for address:', event.address);
                    event.lat = 0;
                    event.lng = 0;
                }
            }).catch(error => {
                console.log('Error:', error.message);
            })

            // uint8array to store image data;
            let imageContent;
            axios.get(event.imgSrc, {responseTye: 'arraybuffer'})
            .then(response => {
                imageContent= new Uint8Array(response.data);
            }).catch(error=> {
                console.error('Error getting image data:', error);
            });


            // if event have lat and lng, add marker to database
            if (event.lat != 0 && event.lng != 0){
            const randomName = chance.name();
            let backendUrl = 'http://fomo-raw-1d33949ca4fc.herokuapp.com/adminAddMarker';

            axios.post(backendUrl, {
                marker: {
                    username: 'Admin', 
                    latitude: location.lat,
                    longitude: location.lng,
                    type: 'event',
                    description: event.title,
                    totalRatings: 0,
                    NoRatings: 0,
                }, 
                imageContent, 
                fileName: `${randomName}.jpg`,
            }
            ).then(response=> {
                console.log('Marker Added:', response.data);
            }).catch(error=> {
                console.error('Error adding marker:', error);
            });
            }
            
            // statesocket.emit('addMarker', {
            //     marker: {
            //         username: 'Admin', 
            //         latitude: location.lat,
            //         longitude: location.lng,
            //         type: 'event',
            //         description: event.title,
            //         totalRatings: 0,
            //         NoRatings: 0,
            //     }, 
            //     imageContent, 
            //     fileName: `${randomName}.jpg`,
            // });
            // }
            // statesocket.emit("incrementUserMarkers", 'Admin');
        }
    }



}).catch((error) => console.error(error));



