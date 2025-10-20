import VideoPlayer from "@/components/VideoPlayer";

export default function Home() {
    return (
        <div className="font-sans min-h-screen p-8 pb-20 bg-gray-900">
            <main className="flex flex-col items-center">
                <VideoPlayer />
            </main>
        </div>
    );
}
