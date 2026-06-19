import {
  FaceVerificationDependencies,
  referenceImageRequestConfig,
  verifyCandidateFace,
} from "./faceVerification";

const input = {
  anchorUrl: "https://commons.wikimedia.org/mateus.jpg",
  candidateUrl: "https://cdn.whufc.com/mateus.jpg",
  threshold: 95,
};

function dependencies(
  comparison: Parameters<
    FaceVerificationDependencies["compareFaces"]
  > extends never
    ? never
    : Awaited<ReturnType<FaceVerificationDependencies["compareFaces"]>>
): FaceVerificationDependencies {
  return {
    downloadImage: async () => Buffer.from("image"),
    compareFaces: async () => comparison,
  };
}

async function run(): Promise<void> {
  const requestConfig = referenceImageRequestConfig();
  if (
    !requestConfig.headers["User-Agent"].includes("RedDevilsNews") ||
    !requestConfig.headers.Accept.includes("image")
  ) {
    throw new Error("Reference image downloads require identifying image headers");
  }

  const accepted = await verifyCandidateFace(
    input,
    dependencies({
      sourceFaceDetected: true,
      targetFaceDetected: true,
      similarities: [98.4],
    })
  );
  if (!accepted.accepted || accepted.similarity !== 98.4) {
    throw new Error("High-confidence face match should pass");
  }

  const belowThreshold = await verifyCandidateFace(
    input,
    dependencies({
      sourceFaceDetected: true,
      targetFaceDetected: true,
      similarities: [94.9],
    })
  );
  if (belowThreshold.accepted) {
    throw new Error("Face match below threshold must fail");
  }

  const missingSource = await verifyCandidateFace(
    input,
    dependencies({
      sourceFaceDetected: false,
      targetFaceDetected: true,
      similarities: [],
    })
  );
  if (missingSource.accepted || missingSource.reason !== "SOURCE_FACE_MISSING") {
    throw new Error("Missing source face must fail closed");
  }

  const missingTarget = await verifyCandidateFace(
    input,
    dependencies({
      sourceFaceDetected: true,
      targetFaceDetected: false,
      similarities: [],
    })
  );
  if (missingTarget.accepted || missingTarget.reason !== "TARGET_FACE_MISSING") {
    throw new Error("Missing target face must fail closed");
  }

  const noMatch = await verifyCandidateFace(
    input,
    dependencies({
      sourceFaceDetected: true,
      targetFaceDetected: true,
      similarities: [],
    })
  );
  if (noMatch.accepted || noMatch.similarity !== null) {
    throw new Error("No face match must fail closed");
  }

  let thresholdUsed = 0;
  await verifyCandidateFace(
    { ...input, threshold: 200 },
    {
      downloadImage: async () => Buffer.from("image"),
      compareFaces: async (_source, _target, threshold) => {
        thresholdUsed = threshold;
        return {
          sourceFaceDetected: true,
          targetFaceDetected: true,
          similarities: [99],
        };
      },
    }
  );
  if (thresholdUsed !== 99) {
    throw new Error("Configured threshold must be clamped to 99");
  }

  const providerError = await verifyCandidateFace(input, {
    downloadImage: async () => {
      throw new Error("network unavailable");
    },
    compareFaces: async () => {
      throw new Error("should not run");
    },
  });
  if (providerError.accepted || providerError.reason !== "VERIFICATION_ERROR") {
    throw new Error("Provider errors must produce a rejected decision");
  }
}

run()
  .then(() => console.log("Face verification tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
