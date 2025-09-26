import os
import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl, Field
from urllib.parse import urlparse, parse_qs
from typing import Optional, Dict, Any
from dotenv import load_dotenv

# Create a FastAPI app instance
app = FastAPI(
    title="Content Identifier API",
    description="An API to identify the source of a given URL.",
    version="1.0.0",
)

# Load environment variables from .env file
load_dotenv()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)


# Pydantic model for the request body to ensure we get a valid URL
class URLItem(BaseModel):
    url: HttpUrl


# Pydantic model for the response
class IdentifyResponse(BaseModel):
    source: str
    content_type: str = "other"
    details: Optional[Dict[str, Any]] = None


@app.post("/identify", response_model=IdentifyResponse)
async def identify_url(item: URLItem):
    """
    Identifies the source and content type of a URL, and fetches details if available.
    """
    parsed_url = urlparse(str(item.url))
    domain = parsed_url.netloc.lower()
    path = parsed_url.path

    async with httpx.AsyncClient() as client:
        if "youtube.com" in domain or "youtu.be" in domain:
            video_id = None
            if "youtube.com" in domain and "watch" in path:
                query_params = parse_qs(parsed_url.query)
                video_id = query_params.get("v", [None])[0]
            elif "youtu.be" in domain:
                video_id = path.lstrip("/")

            if video_id:
                YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY")
                if not YOUTUBE_API_KEY:
                    return {
                        "source": "youtube",
                        "content_type": "video",
                        "details": {"error": "YouTube API key not configured."},
                    }

                api_url = f"https://www.googleapis.com/youtube/v3/videos?id={video_id}&key={YOUTUBE_API_KEY}&part=snippet,statistics"
                response = await client.get(api_url)
                if response.status_code == 200:
                    data = response.json()
                    if data.get("items"):
                        video_data = data["items"][0]
                        details = {
                            "title": video_data["snippet"]["title"],
                            "channel_name": video_data["snippet"]["channelTitle"],
                            "bio": video_data["snippet"].get("description", ""),
                        }

                        # Fetch top 5 comments
                        comments_url = f"https://www.googleapis.com/youtube/v3/commentThreads?videoId={video_id}&key={YOUTUBE_API_KEY}&part=snippet&order=relevance&maxResults=5"
                        comments_response = await client.get(comments_url)
                        if comments_response.status_code == 200:
                            comments_data = comments_response.json()
                            comments = []
                            for item in comments_data.get("items", []):
                                comment_snippet = item["snippet"]["topLevelComment"][
                                    "snippet"
                                ]
                                comments.append(
                                    {
                                        "author": comment_snippet["authorDisplayName"],
                                        "text": comment_snippet["textDisplay"],
                                    }
                                )
                            details["comments"] = comments

                        return {
                            "source": "youtube",
                            "content_type": "video",
                            "details": details,
                        }
            return {"source": "youtube", "content_type": "other"}

        elif "reddit.com" in domain or "redd.it" in domain:
            if "/comments/" in path:
                # Use Reddit's simple JSON API by appending .json to the URL
                json_url = str(item.url).split("?")[0].rstrip("/") + ".json"

                # Reddit API requires a user-agent
                headers = {"User-agent": "ContentIdentifier-Ext-v1.0"}
                response = await client.get(json_url, headers=headers)

                if response.status_code == 200:
                    data = response.json()
                    post_data = data[0]["data"]["children"][0]["data"]
                    details = {
                        "title": post_data["title"],
                        "subreddit": post_data["subreddit_name_prefixed"],
                        "score": post_data["score"],
                        "author": post_data["author"],
                        "comments": post_data["num_comments"],
                    }
                    return {
                        "source": "reddit",
                        "content_type": "post",
                        "details": details,
                    }
            return {"source": "reddit", "content_type": "other"}

    return {"source": "other", "content_type": "other"}
