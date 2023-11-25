
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const sharp = require('sharp');



const Chance = require('chance');
const chance = new Chance();

const axios = require('axios');
const { setUncaughtExceptionCaptureCallback } = require('process');
const apiKey = process.env.GOOGLE_MAPS_API_KEY;


async function fetchTimeOutHotList() {
    const hotListJson = fs.readFileSync('data/timeoutHotList.txt', 'utf8');
    const fetchedHotList = JSON.parse(hotListJson);
    console.log(fetchedHotList[0].title);
    const browser = await puppeteer.launch({
        headless: true,
    });
    const page = await browser.newPage();
    await page.goto('https://www.timeout.com/singapore/things-to-do/the-time-out-singapore-hotlist');

    const events = await page.evaluate(() => 
        Array.from(document.querySelectorAll('div._zoneItems_882m9_1.zoneItems article'), (e) => {
            const titleElement = e.querySelector('._h3_cuogz_1');
            const imagesElements = e.querySelector('div._imageContainer_kc5qn_33 div._imageWrap_kc5qn_229 img');
            const imgSrc = imagesElements ? imagesElements.getAttribute('src') : null;
            const urlElements = e.querySelector('div._title_kc5qn_9 a');
            const url = urlElements ? "https://www.timeout.com" + urlElements.getAttribute('href'): null;
            const dateTimeElements = e.querySelector('span._datesContainer_zxmem_1');
            const dateTime = dateTimeElements ? dateTimeElements.innerText : null;
            
            return {
                title: titleElement ? titleElement.innerText: null,
                imgSrc: imgSrc, 
                url: url,
                dateTime: dateTime,
            }
        }) 
    );

    for (let event of events) {
        const page = await browser.newPage();
        // console.log('Fetching additional information for ' + event.title);
        if (event.url == null){
            continue;
        }
        await page.goto(event.url);
        page.setDefaultNavigationTimeout(60000);

        const eventDetails = await page.evaluate(() => {
            const detailsElement = document.querySelector('div[data-section="details"]');
            const priceElement = document.querySelector('div[data-section="price"]');
            
            const address = detailsElement ? Array.from(detailsElement.querySelectorAll('dd._description_k1wdy_9')).map(el => el.textContent).join(', ') : null;
            const price = priceElement ? priceElement.querySelector('dd._description_k1wdy_9').textContent : null;

            // const dateTimesElements = document.querySelectorAll('div.zoneItems div._articleRow_14oc2_1 time');
            // const dateTimes = Array.from(dateTimesElements).map(el => el.getAttribute('datetime'));

            return {
                address: address,
                price: price,
                // startDate: dateTimes[0],  // First element of dateTimes
                // endDate: dateTimes[dateTimes.length - 1]
            };
        });

        // console.log(eventDetails);

        event.address = eventDetails.address;
        event.price = eventDetails.price;
        // event.startEndDate = [eventDetails.startDate, eventDetails.endDate];
        console.log('Event Scrapped:', event.title)
        await page.close();
    }

    await browser.close();

    return events;
}





async function fetchTimeOutHotListWCoords(){
    try {
        const events = await fetchTimeOutHotList();
        console.log(events);
        const eventsJson = JSON.stringify(events, null, 2);
        scrapePath = path.join(__dirname, 'data', 'timeoutHotList.txt');
        fs.writeFileSync(scrapePath, eventsJson);

        const hotListJson = fs.readFileSync('data/timeoutHotList.txt', 'utf8');
        const fetchedHotList = JSON.parse(hotListJson); 
        // console.log(fetchedHotList);

        let fetchedHotListWCoords = [];
    for (let event of fetchedHotList){
        // if no address, skip event
        console.log('Event:', event.title);
        if (event.address == "" || event.address==null){
            console.log('No address for:', event.title)
            continue;
        }else{
            // retrieving the coordinates for the address
            console.log('Start geoLocation Coords')
            let address = event.address;
            let url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`
            let response = await axios.get(url)
            // console.log(response);
            if(response.data.results.length > 0){
                let location = response.data.results[0].geometry.location;
                // console.log('Address for: ', event.title, ':', location.lat, location.lng);
                event.lat = location.lat;
                event.lng = location.lng;

                // console.log('Start crafting Object')
                // console.log(`Event lat: ${event.lat}, Event lng: ${event.lng}`)
                // if event have lat and lng, add marker to database
                if (event.lat != 0 && event.lng != 0){
                // const randomName = chance.name();
    
                let marker = {
                        username: 'Admin', 
                        latitude: location.lat,
                        longitude: location.lng,
                        type: 'event',
                        description: event.title,
                        totalRatings: 0,
                        NoRatings: 0,
                        imgSrc: event.imgSrc,
                    }
                                //     imageContent, 
        //     fileName: `${randomName}.jpg`,
    
                // let fileName= `${randomName}.jpg`;
    
                console.log('Done with crafting object')
                // console.log(marker, fileName)
                fetchedHotListWCoords.push(marker);
                // console.log(marker, imageContent);
                }
            }
            else{
                console.log('No results found for address:', event.address);
                event.lat = 0;
                event.lng = 0;
            }
        }
    }return fetchedHotListWCoords;
    } catch (error) {
        console.log('Error:', error.message);
    } 

}   

async function addImageToMarker(){
    try {
        const fetchedHotListWCoords = await fetchTimeOutHotListWCoords();
        console.log(fetchedHotListWCoords);
        for (let marker of fetchedHotListWCoords){
            console.log('Start image Content')
            // uint8array to store image data;
            let response = await axios.get(marker.imgSrc, {responseType: 'arraybuffer'})
            console.log(response.data);
            let resizedImageBuffer = await sharp(response.data).resize(100, 100).toBuffer();
            // let resizedImageBuffer = await sharp(response.data)
            //     .jpeg({ quality: 50 }) // Lower the quality to reduce file size
            //     .toBuffer();
            console.log(resizedImageBuffer);
            let uint8Array = new Uint8Array(resizedImageBuffer);
            // Convert the Uint8Array to a regular array
            let array = Array.from(uint8Array);
            // Use the array as the imageContent
            marker.imageContent = array;
            // imageContent= new Uint8Array(resizedImageBuffer);
            // // console.log(imageContent);
            // marker.imageContent = imageContent;
            // // console.log(marker.imageContent);
        }
        // console.log(fetchedHotListWCoords);
        return fetchedHotListWCoords;
    } catch (error) {
        console.log('Error:', error.message, error.stack);
    }
}

async function addMarkerToDB(){
    try {
        const markers = await addImageToMarker();

            
            let backendUrl = 'https://fomo-raw-1d33949ca4fc.herokuapp.com/adminAddMarker';
            // let newMarkers = markers.slice(0, 1);
            // for (let marker of newMarkers){
            for (let marker of markers){
                const randomName = chance.name();
                const imageContent = marker.imageContent;
                // const imageContent = '123'
                console.log(imageContent);
                try {
                    const response = await axios.post(backendUrl, {
                        marker: {
                        username: 'Admin',
                        latitude: marker.latitude,
                        longitude: marker.longitude,
                        type: 'event',
                        description: marker.title,
                        totalRatings: 0,
                        NoRatings: 0,
                        rating: 0,
                        reviews: 0,
                        }, 
                        imageContent,
                        fileName: `${randomName}.jpg`})

                    console.log('Marker Added:', response.data);
                    } catch (error) {
                    console.log('Error:', error.message, error.stack);
                    }
                } 
    } catch (error){
        console.log('Error:', error.message, error.stack)
    }
}

addMarkerToDB();


    
