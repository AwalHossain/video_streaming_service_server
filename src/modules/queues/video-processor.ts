/** execute function will take a filePath and run  ffmpeg command to convert it to mp4 */
import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import eventEmitter from './../../event-manager';
import { NOTIFY_EVENTS, QUEUE_EVENTS } from "./constants";
import { addQueueItem } from "./queue";


ffmpeg.setFfmpegPath(ffmpegPath);
interface JobData {
  completed: boolean;
  path: string;
  destination: string;
  // other properties
}

interface ProcessedFile {
  fileName: string;
  outputFileName: string;
}

interface WatermarkFile {
  fileName: string;
  outputFileName: string;
  watermarkImage: string;
}

const processRawFileToMp4WithWatermark = async (
  filePath: string,
  outputFolder: string,
  jobData: JobData,
  watermarkImageFilePath?: string | null
): Promise<WatermarkFile> => {
  const fileExt = path.extname(filePath);
  const fileNameWithoutExt = path.basename(filePath, fileExt);

  const outputFileName = `${outputFolder}/${fileNameWithoutExt}.mp4`;

  const ffmpegCommand = ffmpeg(filePath).output(outputFileName);

  const videoMetadata = await getVideoDurationAndResolution(filePath) as any;


  // Calculate the dimensions for the watermark image based on the video's aspect ratio.
  const videoWidth = videoMetadata.videoResolution.width;
  const videoHeight = videoMetadata.videoResolution.height;


  if (watermarkImageFilePath) {
    const watermarkAspectRatio = await getImageAspectRatio(watermarkImageFilePath) as any;
    const [widthRatio, heightRatio] = watermarkAspectRatio.split(':').map(Number);
    const aspectRatioDecimal = widthRatio / heightRatio;

    console.log(aspectRatioDecimal, 'watermarkAspectRatio', videoMetadata, 'videoMetadata');

    const watermarkWidth = videoWidth / 9; // Adjust the scaling factor as needed.
    const watermarkHeight = watermarkWidth / aspectRatioDecimal;

    if (!aspectRatioDecimal || isNaN(aspectRatioDecimal)) {
      console.error('Invalid watermark aspect ratio');
      return;
    }
    ffmpegCommand.input(watermarkImageFilePath).complexFilter([
      `[0:v]scale=${videoWidth}:${videoHeight}[bg];` +
      `[1:v]scale=${watermarkWidth}:${watermarkHeight}[watermark];` +
      `[bg][watermark]overlay=W-w-10:10:enable='between(t,0,inf)'`,
    ]);
  }

  ffmpegCommand
    .on("start", function (commandLine: string) {
      console.log("Spawned Ffmpeg with command: " + commandLine);
    })
    .on("progress", function (progress: any) {
      console.log("Processing: " + progress.percent + "% done");
      eventEmitter.emit(NOTIFY_EVENTS.NOTIFY_VIDEO_PROCESSING, {
        status: "success",
        message: "Video processing",
        data: progress.percent
      })
    })
    .on("end", async function () {
      console.log("Finished processing");
      eventEmitter.emit(NOTIFY_EVENTS.NOTIFY_VIDEO_PROCESSED, {
        status: "success",
        message: "Video Processed",
      })
      await addQueueItem(QUEUE_EVENTS.VIDEO_PROCESSED, {
        ...jobData,
        completed: true,
        path: outputFileName,
      });

    })
    .on("error", function (err: Error) {
      eventEmitter.emit(NOTIFY_EVENTS.NOTIFY_EVENTS_FAILED, {
        status: "failed",
        message: "Video Processed failed",
      })
      console.log("An error occurred: " + err.message);
    })
    .run();

  const folderName = jobData.destination.split("/")[1];
  const uploadPath = `uploads/${folderName}/thumbnails`;
  fs.mkdirSync(uploadPath, { recursive: true });

  generateThumbnail(filePath, uploadPath, {
    ...jobData,
    completed: true,
  });

  return;
};


const generateThumbnail = async (
  filePath: string,
  outputFolder: string,
  jobData: JobData
): Promise<ProcessedFile> => {
  const fileExt = path.extname(filePath);
  const fileNameWithoutExt = path.basename(filePath, fileExt);
  const thumbnailFileName = `${fileNameWithoutExt}.png`;
  const outputFileName = `${outputFolder}/${thumbnailFileName}`;
  console.log(thumbnailFileName, 'thumbnailFileName');
  ffmpeg(filePath)
    .screenshots({
      timestamps: ['00:01'],
      filename: thumbnailFileName,
      folder: `${outputFolder}`,
      size: "320x240",
    })
    .on('end', async function () {
      console.log("hthumnail generated!", jobData.path);
      // await addQueueItem(QUEUE_EVENTS.VIDEO_THUMBNAIL_GENERATED, {
      //   ...jobData,
      //   completed: true,
      //   path: thumbnailFileName
      // });
    })
  return;

};


// / Define a function to create HLS variants for different qualitie



const processMp4ToHls = async (
  filePath: string,
  outputFolder: string,
  jobData: JobData
): Promise<ProcessedFile> => {
  const fileName = path.basename(filePath);
  const fileExt = path.extname(filePath);
  const fileNameWithoutExt = path.basename(filePath, fileExt);
  console.log(outputFolder, 'again checking output folder');

  const renditions = [
    { resolution: '854x480', bitrate: '800k', name: '480p' },
    { resolution: '1920x1080', bitrate: '5000k', name: '1080p' },
  ];

  // Create renditions
  const promises = renditions.map((rendition) => {
    return new Promise<void>((resolve, reject) => {
      ffmpeg(filePath)
        .output(`${outputFolder}/${fileNameWithoutExt}_${rendition.name}.m3u8`)
        .outputOptions([
          `-s ${rendition.resolution}`,
          `-c:v libx264`,
          `-crf 23`,
          `-preset slow`,
          `-b:v ${rendition.bitrate}`,
          `-g 48`,
          `-hls_time 10`,
          `-hls_list_size 0`,
          `-hls_segment_filename`,
          `${outputFolder}/${fileNameWithoutExt}_${rendition.name}_%03d.ts`,
        ])
        .on('start', function (commandLine: string) {
          console.log('Spawned Ffmpeg with command: ' + commandLine);
        })
        .on('progress', function (progress: any) {
          console.log(`Processing: ${progress.percent}% done for ${rendition.name}`);
          eventEmitter.emit(NOTIFY_EVENTS.NOTIFY_EVENTS_VIDEO_BIT_RATE_PROCESSING, {
            status: "success",
            message: "Video processing",
            data: `Processing: ${progress.percent}% done for ${rendition.name}`
          })
        })
        .on('end', function () {
          console.log(`Finished processing ${rendition.name}`);
          eventEmitter.emit(NOTIFY_EVENTS.NOTIFY_EVENTS_VIDEO_BIT_RATE_PROCESSED, {
            status: "success",
            message: "Video Processed",
          })
          resolve();
        })
        .on('error', function (err: Error) {
          console.log('An error occurred: ' + err.message);
          eventEmitter.emit(NOTIFY_EVENTS.NOTIFY_EVENTS_FAILED, {
            status: "failed",
            message: "Video convering Processed failed",
          })
          reject(err);
        })
        .run();
    });
  });

  // Wait for all renditions to complete
  await Promise.all(promises);


  // Create master playlist file
  const masterPlaylistContent = `#EXTM3U
#EXT-X-VERSION:3
${renditions.map(
    (rendition) => `#EXT-X-STREAM-INF:BANDWIDTH=${parseInt(rendition.bitrate)}000,RESOLUTION=${rendition.resolution}\n${fileNameWithoutExt}_${rendition.name}.m3u8`
  ).join('\n')}
`;
  const outputFileName = `${outputFolder}/${fileNameWithoutExt}_master.m3u8`;
  fs.writeFileSync(outputFileName, masterPlaylistContent);

  addQueueItem(QUEUE_EVENTS.VIDEO_HLS_CONVERTED, {
    ...jobData,
    path: outputFileName,
  });


  return;
};


// get video duration & resolution

const getVideoDurationAndResolution = async (filePath: string) => {

  return new Promise((resolve, reject) => {

    let videoDuration = 0;
    let videoResolution = {
      width: 0,
      height: 0
    };

    ffmpeg.ffprobe(filePath, (err: any, metadata: any) => {
      if (err) {
        reject(err);
      }
      videoDuration = parseInt(metadata.format.duration);


      videoResolution.width = metadata.streams[0].width;
      videoResolution.height = metadata.streams[0].height;
      resolve({ videoDuration, videoResolution });
      return;
    });
  });
}


const getImageAspectRatio = async (filePath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err: any, metadata: any) => {
      if (err) {
        reject(err);
      }
      const imageAspectRatio = metadata.streams[0].display_aspect_ratio;
      resolve(imageAspectRatio);
      return;
    });
  });
}


export { processMp4ToHls, processRawFileToMp4WithWatermark };

