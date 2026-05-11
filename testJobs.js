const axios = require("axios");

const createJobs = async () => {
  const requests = [];

  for (let i = 0; i < 10; i++) {
    requests.push(
      axios.post("http://localhost:3000/api/jobs", {
        type: "email",
        payload: {
          to: `user${i}@gmail.com`,
          subjectL:'Welcom'
        },
      })
    );
  }

  await Promise.all(requests);
  console.log("✅ 10 jobs created");
};

createJobs();